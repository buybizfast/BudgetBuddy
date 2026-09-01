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
from sqlalchemy import select, text

from backend.db.base import engine, session_scope
from backend.db.models import Base

# create_all() only creates missing tables — it never alters existing ones. Columns
# added to a model after its table already exists in a deployed database need an
# explicit, idempotent ALTER here so the deployed schema stays in sync.
_SCHEMA_PATCHES = [
    "ALTER TABLE plaid_items ADD COLUMN IF NOT EXISTS last_sync_error VARCHAR(500)",
    "ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS credit_limit NUMERIC(12, 2)",
    "ALTER TABLE budget_categories ADD COLUMN IF NOT EXISTS cost_type VARCHAR(10) NOT NULL DEFAULT 'variable'",
    "ALTER TABLE budget_categories ADD COLUMN IF NOT EXISTS due_date_day INTEGER",
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

    # --- Multi-user migration ---------------------------------------------
    # user_id columns are added nullable (Postgres can't add NOT NULL to a
    # populated table without a default). _MULTI_USER_NOT_NULL_PATCHES tightens
    # them once claim_legacy_data() has given every pre-existing row an owner.
    "ALTER TABLE plaid_items ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE",
    "ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE",
    "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE",
    "ALTER TABLE budget_months ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE",
    "ALTER TABLE budget_categories ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE",
    "ALTER TABLE debt_accounts ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE",
    "ALTER TABLE savings_goals ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE",
    "ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE",
    "ALTER TABLE bill_payments ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE",
    "ALTER TABLE paychecks ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE",
    "ALTER TABLE net_worth_snapshots ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE",
    "ALTER TABLE spending_alerts ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE",

    # Old single-tenant unique constraints conflict with per-user data —
    # replace with user-scoped ones.
    "ALTER TABLE user_subscriptions DROP CONSTRAINT IF EXISTS user_subscriptions_merchant_name_key",
    "DO $$ BEGIN "
    "  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_user_subscription_user_merchant') THEN "
    "    ALTER TABLE user_subscriptions ADD CONSTRAINT uq_user_subscription_user_merchant UNIQUE (user_id, merchant_name); "
    "  END IF; "
    "END $$",
    "ALTER TABLE bill_payments DROP CONSTRAINT IF EXISTS uq_bill_payment_merchant_month",
    "DO $$ BEGIN "
    "  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_bill_payment_user_merchant_month') THEN "
    "    ALTER TABLE bill_payments ADD CONSTRAINT uq_bill_payment_user_merchant_month UNIQUE (user_id, merchant_name, year, month); "
    "  END IF; "
    "END $$",
    "ALTER TABLE net_worth_snapshots DROP CONSTRAINT IF EXISTS uq_net_worth_snapshot_ym",
    "DO $$ BEGIN "
    "  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_net_worth_snapshot_user_ym') THEN "
    "    ALTER TABLE net_worth_snapshots ADD CONSTRAINT uq_net_worth_snapshot_user_ym UNIQUE (user_id, year, month); "
    "  END IF; "
    "END $$",
    "DO $$ BEGIN "
    "  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_budget_month_user_ym') THEN "
    "    ALTER TABLE budget_months ADD CONSTRAINT uq_budget_month_user_ym UNIQUE (user_id, year, month); "
    "  END IF; "
    "END $$",

    # --- Manual cash placeholder -------------------------------------------
    # Pre-multi-user rows use the bare ids "manual" / "manual-cash", which the
    # LIKE "manual-%" exclusions miss — so the placeholder item was being sent
    # to Plaid every sync, failing with INVALID_ACCESS_TOKEN because its token
    # is the literal string "manual". Normalise them to the per-user form and
    # clear the error state that produced.
    "UPDATE plaid_items SET item_id = 'manual-' || user_id "
    "WHERE item_id = 'manual' AND user_id IS NOT NULL",
    "UPDATE bank_accounts SET account_id = 'manual-cash-' || user_id "
    "WHERE account_id = 'manual-cash' AND user_id IS NOT NULL",
    "UPDATE plaid_items SET last_sync_error = NULL, status = 'active' "
    "WHERE item_id = 'manual' OR item_id LIKE 'manual-%'",

    # --- Google sign-in ----------------------------------------------------
    # Google accounts have no password, so the column must allow NULL.
    "ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub VARCHAR(64)",
    "DO $$ BEGIN "
    "  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_google_sub_key') THEN "
    "    ALTER TABLE users ADD CONSTRAINT users_google_sub_key UNIQUE (google_sub); "
    "  END IF; "
    "END $$",
]

# Applied once claim_legacy_data() has backfilled user_id on every
# pre-existing row — only safe to enforce NOT NULL at that point.
_MULTI_USER_NOT_NULL_PATCHES = [
    f"ALTER TABLE {table} ALTER COLUMN user_id SET NOT NULL"
    for table in (
        "plaid_items", "bank_accounts", "transactions", "budget_months",
        "budget_categories", "debt_accounts", "savings_goals",
        "user_subscriptions", "bill_payments", "paychecks",
        "net_worth_snapshots", "spending_alerts",
    )
]

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

limiter = Limiter(key_func=get_remote_address, default_limits=["200/minute"])

log = logging.getLogger("api.main")

_OWNED_TABLES = (
    "plaid_items", "bank_accounts", "transactions", "budget_months",
    "budget_categories", "debt_accounts", "savings_goals",
    "user_subscriptions", "bill_payments", "paychecks",
    "net_worth_snapshots", "spending_alerts",
)


async def has_unclaimed_data(db) -> bool:
    """True if rows exist from before multi-user that no account owns yet."""
    for table in _OWNED_TABLES:
        result = await db.execute(text(f"SELECT 1 FROM {table} WHERE user_id IS NULL LIMIT 1"))
        if result.first() is not None:
            return True
    return False


async def claim_legacy_data(user_id: str, db) -> int:
    """Assign every pre-multi-user row to this account.

    Minting a bootstrap account from environment credentials (the previous
    approach) stranded the data behind a password that no longer matched what
    was in the environment. Instead the data sits unowned until a real account
    claims it at signup, so the owner always knows the password — they chose
    it themselves."""
    claimed = 0
    for table in _OWNED_TABLES:
        result = await db.execute(
            text(f"UPDATE {table} SET user_id = :uid WHERE user_id IS NULL"), {"uid": user_id}
        )
        claimed += result.rowcount or 0
    await db.commit()
    log.info("Claimed %d pre-existing rows for user %s", claimed, user_id)
    # Now that nothing is unowned, the NOT NULL constraints can finally apply.
    for stmt in _MULTI_USER_NOT_NULL_PATCHES:
        try:
            async with engine.begin() as conn:
                await conn.execute(text(stmt))
        except Exception as exc:
            log.warning("Deferred NOT NULL patch failed (%s): %s", stmt[:60], exc)
    return claimed


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
    # NOT NULL on user_id can only apply once nothing is unowned. On a fresh
    # database that's immediately true; on an upgrade it stays deferred until
    # claim_legacy_data() runs at the owner's signup, which re-applies these.
    try:
        async with session_scope() as db:
            unclaimed = await has_unclaimed_data(db)
    except Exception as exc:
        log.error("Unclaimed-data check failed: %s", exc)
        unclaimed = True
    if unclaimed:
        log.info("Pre-multi-user data is unowned — the first account to sign up will claim it")
    else:
        for stmt in _MULTI_USER_NOT_NULL_PATCHES:
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
                from backend.db.models import PlaidItem
                async with session_scope() as db:
                    result = await db.execute(select(PlaidItem.user_id).where(PlaidItem.status == "active").distinct())
                    user_ids = [row[0] for row in result.all()]
                    for uid in user_ids:
                        summary = await refresh_all_items(db, uid)
                        if summary["total_added"] > 0:
                            await ws_manager.broadcast_budget_update(summary["total_added"], summary["new_transactions"], uid)
                            log.info("Budget sync: %d new transactions broadcast for user %s", summary["total_added"], uid)
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
@app.middleware("http")
async def surface_errors_with_cors(request: Request, call_next):
    """Convert an unhandled exception into a JSON 500 *inside* the CORS
    middleware, so the browser gets a readable error instead of a response
    with no CORS headers — which it reports as an unreachable server, hiding
    the real failure entirely."""
    try:
        return await call_next(request)
    except Exception as exc:
        log.exception("Unhandled error on %s %s", request.method, request.url.path)
        return JSONResponse(status_code=500, content={"detail": f"Server error: {exc}"})


# Added AFTER the error middleware so CORS ends up outermost and stamps its
# headers onto that 500 response too.
# allow_origin_regex covers every Vercel deployment of this frontend —
# production plus the per-commit preview URLs — so a missing or stale
# CORS_ORIGINS can't silently break the browser with what looks like an
# unreachable server. Explicit CORS_ORIGINS entries still apply on top.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in CORS_ORIGINS if o.strip()],
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
log.info("CORS allowed origins: %s (+ *.vercel.app)", CORS_ORIGINS)

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
