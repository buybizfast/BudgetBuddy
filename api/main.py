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
from api.ws_manager import ws_manager
from sqlalchemy import text

from backend.db.base import engine, session_scope
from backend.db.models import Base

# create_all() only creates missing tables — it never alters existing ones. Columns
# added to a model after its table already exists in a deployed database need an
# explicit, idempotent ALTER here so the deployed schema stays in sync.
_SCHEMA_PATCHES = [
    "ALTER TABLE budget_categories ADD COLUMN IF NOT EXISTS cost_type VARCHAR(10) NOT NULL DEFAULT 'variable'",
    "ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS is_manual BOOLEAN NOT NULL DEFAULT false",
    "ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT false",
    "ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS amount NUMERIC(12, 2)",
    "ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS cadence VARCHAR(20)",
    "ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS next_expected DATE",
]

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

limiter = Limiter(key_func=get_remote_address, default_limits=["200/minute"])

log = logging.getLogger("api.main")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        for stmt in _SCHEMA_PATCHES:
            await conn.execute(text(stmt))
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

    sync_task = asyncio.create_task(budget_sync_loop())
    yield
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

@app.get("/", tags=["health"])
async def health():
    return {"status": "ok", "service": "Budget Buddy"}
