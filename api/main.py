"""Budget Buddy — standalone FastAPI application."""
from __future__ import annotations

import asyncio
import logging
import time
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from backend.config import CORS_ORIGINS, BUDGET_SYNC_INTERVAL_SECS, PLAID_CLIENT_ID
from api.auth import get_current_user
from api.routes import budget, plaid, debt, goals, spending_analytics, ws
from api.routes import auth as auth_router
from api.routes import subscriptions as subscriptions_router
from api.routes import spending_alerts as alerts_router
from api.routes import bills as bills_router
from api.routes import networth as networth_router
from api.routes import report as report_router
from api.routes import coach as coach_router
from api.routes import paychecks as paychecks_router
from api.routes import safe_to_spend as safe_to_spend_router
from api.routes import digest as digest_router
from api.routes import insights as insights_router
from api.routes import cashflow as cashflow_router
from api.ws_manager import ws_manager
from sqlalchemy import text

from backend.db.base import engine, session_scope
from backend.db.models import Base

# create_all() only creates missing tables — it never alters existing ones. Columns
# added to a model after its table already exists in a deployed database need an
# explicit, idempotent ALTER here so the deployed schema stays in sync.
_SCHEMA_PATCHES = [
    "ALTER TABLE plaid_items ADD COLUMN IF NOT EXISTS last_sync_error VARCHAR(500)",
    "ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS credit_limit NUMERIC(12, 2)",
    "ALTER TABLE budget_categories ADD COLUMN IF NOT EXISTS cost_type VARCHAR(10) NOT NULL DEFAULT 'variable'",
    "ALTER TABLE budget_categories ADD COLUMN IF NOT EXISTS debt_account_id UUID REFERENCES debt_accounts(id) ON DELETE SET NULL",
    "ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS is_manual BOOLEAN NOT NULL DEFAULT false",
    "ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT false",
    "ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS amount NUMERIC(12, 2)",
    "ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS cadence VARCHAR(20)",
    "ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS next_expected DATE",
    # debt_accounts: patched defensively for every model column, not just the
    # newest ones — some deployed databases have a stale copy of this table
    # predating fields like account_type that have existed in the model for a
    # while, and create_all() never retrofits an existing table.
    "ALTER TABLE debt_accounts ADD COLUMN IF NOT EXISTS original_balance NUMERIC(12, 2)",
    "ALTER TABLE debt_accounts ADD COLUMN IF NOT EXISTS credit_limit NUMERIC(12, 2)",
    "ALTER TABLE debt_accounts ADD COLUMN IF NOT EXISTS minimum_payment NUMERIC(12, 2) NOT NULL DEFAULT 0",
    "ALTER TABLE debt_accounts ADD COLUMN IF NOT EXISTS interest_rate NUMERIC(6, 4) NOT NULL DEFAULT 0",
    "ALTER TABLE debt_accounts ADD COLUMN IF NOT EXISTS account_type VARCHAR(30) NOT NULL DEFAULT 'loan'",
    "ALTER TABLE debt_accounts ADD COLUMN IF NOT EXISTS due_date_day INTEGER",
    "ALTER TABLE debt_accounts ADD COLUMN IF NOT EXISTS statement_date_day INTEGER",
    "ALTER TABLE debt_accounts ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE debt_accounts ADD COLUMN IF NOT EXISTS is_paid_off BOOLEAN NOT NULL DEFAULT false",
    "ALTER TABLE debt_accounts ADD COLUMN IF NOT EXISTS bank_account_id UUID REFERENCES bank_accounts(id) ON DELETE SET NULL",
    "ALTER TABLE debt_accounts ADD COLUMN IF NOT EXISTS dismissed BOOLEAN NOT NULL DEFAULT false",
    "ALTER TABLE debt_accounts ADD COLUMN IF NOT EXISTS total_installments INTEGER",
    "ALTER TABLE debt_accounts ADD COLUMN IF NOT EXISTS installments_paid INTEGER NOT NULL DEFAULT 0",
    "DO $$ BEGIN "
    "  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'debt_accounts_bank_account_id_key') THEN "
    "    ALTER TABLE debt_accounts ADD CONSTRAINT debt_accounts_bank_account_id_key UNIQUE (bank_account_id); "
    "  END IF; "
    "END $$",
]

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

limiter = Limiter(key_func=get_remote_address, default_limits=["200/minute"])

log = logging.getLogger("api.main")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    # Each patch runs in its own transaction — if one fails (e.g. against an
    # unexpectedly stale table), it must not abort the connection for every
    # statement after it, which would silently no-op the rest of the patches.
    for stmt in _SCHEMA_PATCHES:
        try:
            async with engine.begin() as conn:
                await conn.execute(text(stmt))
        except Exception as exc:
            log.error("Schema patch failed (%s): %s", stmt[:80], exc)
    log.info("Database tables created/verified")

    async def budget_sync_loop() -> None:
        from backend.services.plaid_service import refresh_all_items
        if not PLAID_CLIENT_ID:
            log.info("Plaid not configured — budget sync loop idle")
            return
        log.info("Budget sync loop started (interval: %ds, aligned to wall-clock boundaries)", BUDGET_SYNC_INTERVAL_SECS)
        while True:
            # Sleep until the next wall-clock multiple of the interval (e.g. for the
            # default 900s/15min interval: :00/:15/:30/:45) instead of drifting from
            # whenever the process happened to start.
            await asyncio.sleep(BUDGET_SYNC_INTERVAL_SECS - (time.time() % BUDGET_SYNC_INTERVAL_SECS))
            try:
                async with session_scope() as db:
                    summary = await refresh_all_items(db)
                if summary["total_added"] > 0:
                    await ws_manager.broadcast_budget_update(summary["total_added"], summary["new_transactions"])
                    log.info("Budget sync: %d new transactions broadcast", summary["total_added"])
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.error("Budget sync error: %s", exc)

    async def digest_loop() -> None:
        # Check hourly whether the weekly digest is due (Monday morning);
        # maybe_send_weekly_digest dedupes per ISO week, so restarts and
        # repeated checks can't double-send.
        from backend.services.digest_service import maybe_send_weekly_digest
        while True:
            try:
                async with session_scope() as db:
                    await maybe_send_weekly_digest(db)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.error("Digest loop error: %s", exc)
            await asyncio.sleep(3600)

    sync_task = asyncio.create_task(budget_sync_loop())
    digest_task = asyncio.create_task(digest_loop())
    yield
    digest_task.cancel()
    try:
        await digest_task
    except asyncio.CancelledError:
        pass
    sync_task.cancel()
    try:
        await sync_task
    except asyncio.CancelledError:
        pass
    log.info("Budget sync task stopped")


app = FastAPI(title="Budget Buddy", description="Dave Ramsey-style zero-based budgeting app", version="1.0.0", lifespan=lifespan)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(CORSMiddleware, allow_origins=CORS_ORIGINS, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

app.include_router(auth_router.router)

_protected = {"dependencies": [Depends(get_current_user)]}
app.include_router(budget.router, **_protected)
app.include_router(plaid.router, **_protected)
app.include_router(debt.router, **_protected)
app.include_router(goals.router, **_protected)
app.include_router(spending_analytics.router, **_protected)
app.include_router(ws.router)  # WebSocket auth handled separately
app.include_router(subscriptions_router.router, **_protected)
app.include_router(alerts_router.router, **_protected)
app.include_router(bills_router.router, **_protected)
app.include_router(networth_router.router, **_protected)
app.include_router(report_router.router, **_protected)
app.include_router(coach_router.router, **_protected)
app.include_router(paychecks_router.router, **_protected)
app.include_router(safe_to_spend_router.router, **_protected)
app.include_router(digest_router.router, **_protected)
app.include_router(insights_router.router, **_protected)
app.include_router(cashflow_router.router, **_protected)

@app.get("/", tags=["health"])
async def health():
    return {"status": "ok", "service": "Budget Buddy"}
