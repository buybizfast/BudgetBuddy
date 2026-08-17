"""Spending analytics routes."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from api.auth import get_current_user
from backend.db.base import get_session
from backend.services import analytics_service

router = APIRouter(prefix="/api/v1/spending-analytics", tags=["spending-analytics"])

@router.get("/trend")
async def monthly_trend(months: int = Query(default=6, ge=1, le=24), user_id: str = Depends(get_current_user), db: AsyncSession = Depends(get_session)):
    return await analytics_service.monthly_group_trend(user_id, months, db)

@router.get("/top-merchants")
async def top_merchants(year: int = Query(...), month: int = Query(...), limit: int = Query(default=10, le=50), user_id: str = Depends(get_current_user), db: AsyncSession = Depends(get_session)):
    return await analytics_service.top_merchants(user_id, year, month, limit, db)

@router.get("/year-summary")
async def year_summary(year: int = Query(...), user_id: str = Depends(get_current_user), db: AsyncSession = Depends(get_session)):
    return await analytics_service.year_summary(user_id, year, db)

@router.get("/category-breakdown")
async def category_breakdown(year: int = Query(...), month: int = Query(...), user_id: str = Depends(get_current_user), db: AsyncSession = Depends(get_session)):
    return await analytics_service.category_breakdown(user_id, year, month, db)
