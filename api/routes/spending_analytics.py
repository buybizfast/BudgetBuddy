"""Spending analytics routes."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db.base import get_session
from backend.services import analytics_service

router = APIRouter(prefix="/api/v1/spending-analytics", tags=["spending-analytics"])

@router.get("/trend")
async def monthly_trend(months: int = Query(default=6, ge=1, le=24), db: AsyncSession = Depends(get_session)):
    return await analytics_service.monthly_group_trend(months, db)

@router.get("/top-merchants")
async def top_merchants(year: int = Query(...), month: int = Query(...), limit: int = Query(default=10, le=50), db: AsyncSession = Depends(get_session)):
    return await analytics_service.top_merchants(year, month, limit, db)

@router.get("/year-summary")
async def year_summary(year: int = Query(...), db: AsyncSession = Depends(get_session)):
    return await analytics_service.year_summary(year, db)

@router.get("/category-breakdown")
async def category_breakdown(year: int = Query(...), month: int = Query(...), db: AsyncSession = Depends(get_session)):
    return await analytics_service.category_breakdown(year, month, db)
