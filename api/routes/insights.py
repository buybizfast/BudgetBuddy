"""Proactive insight alerts for the home screen."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db.base import get_session
from backend.services.proactive_insights import get_proactive_alerts

router = APIRouter(prefix="/api/v1/insights", tags=["insights"])


@router.get("/alerts")
async def list_alerts(db: AsyncSession = Depends(get_session)):
    return await get_proactive_alerts(db)
