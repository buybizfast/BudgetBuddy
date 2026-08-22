"""Proactive insight alerts for the home screen."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from api.auth import get_current_user
from backend.db.base import get_session
from backend.services.proactive_insights import get_proactive_alerts

router = APIRouter(prefix="/api/v1/insights", tags=["insights"])


@router.get("/alerts")
async def list_alerts(user_id: str = Depends(get_current_user), db: AsyncSession = Depends(get_session)):
    return await get_proactive_alerts(user_id, db)
