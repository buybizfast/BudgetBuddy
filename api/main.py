"""Budget Buddy — standalone FastAPI application."""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.config import CORS_ORIGINS, BUDGET_SYNC_INTERVAL_SECS, PLAID_CLIENT_ID
from api.auth import get_current_user
from api.routes import budget, plaid, debt, goals, spending_analytics, ws
from api.routes import auth as auth_router
from api.routes import subscriptions as subscriptions_router
from api.routes import spending_alerts as alerts_router
from api.ws_manager import ws_manager
from backend.db.base import engine, session_scope
from backend.db.models import Base

log = logging.getLogger("api.main")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    log.info("Database tables created/verified")

    async def budget_sync_loop() -> None:
        from backend.services.plaid_service import refresh_all_items
        if not PLAID_CLIENT_ID:
            log.info("Plaid not configured — budget sync loop idle")
            return
        log.info("Budget sync loop started (interval: %ds)", BUDGET_SYNC_INTERVAL_SECS)
        while True:
            await asyncio.sleep(BUDGET_SYNC_INTERVAL_SECS)
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

@app.get("/", tags=["health"])
async def health():
    return {"status": "ok", "service": "Budget Buddy"}
