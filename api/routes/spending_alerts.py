"""Spending alert configuration and checking."""
from __future__ import annotations

from datetime import datetime

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db.base import get_session
from backend.db.models import BudgetCategory, BudgetGroup, BudgetMonth, SpendingAlert, Transaction

router = APIRouter(prefix="/api/v1/alerts", tags=["alerts"])


class AlertCreate(BaseModel):
    category_id: str
    threshold_pct: int = 80
    enabled: bool = True


class AlertUpdate(BaseModel):
    threshold_pct: Optional[int] = None
    enabled: Optional[bool] = None


@router.get("/")
async def list_alerts(db: AsyncSession = Depends(get_session)):
    result = await db.execute(select(SpendingAlert))
    alerts = result.scalars().all()
    return [{"id": str(a.id), "category_id": str(a.category_id), "threshold_pct": a.threshold_pct, "enabled": a.enabled} for a in alerts]


@router.post("/")
async def create_alert(body: AlertCreate, db: AsyncSession = Depends(get_session)):
    existing = await db.execute(select(SpendingAlert).where(SpendingAlert.category_id == body.category_id))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Alert already exists for this category")
    alert = SpendingAlert(category_id=body.category_id, threshold_pct=body.threshold_pct, enabled=body.enabled)
    db.add(alert)
    await db.commit()
    await db.refresh(alert)
    return {"id": str(alert.id), "category_id": str(alert.category_id), "threshold_pct": alert.threshold_pct, "enabled": alert.enabled}


@router.patch("/{alert_id}")
async def update_alert(alert_id: str, body: AlertUpdate, db: AsyncSession = Depends(get_session)):
    result = await db.execute(select(SpendingAlert).where(SpendingAlert.id == alert_id))
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    if body.threshold_pct is not None:
        alert.threshold_pct = body.threshold_pct
    if body.enabled is not None:
        alert.enabled = body.enabled
    alert.updated_at = datetime.utcnow()
    await db.commit()
    return {"id": str(alert.id), "threshold_pct": alert.threshold_pct, "enabled": alert.enabled}


@router.delete("/{alert_id}")
async def delete_alert(alert_id: str, db: AsyncSession = Depends(get_session)):
    result = await db.execute(select(SpendingAlert).where(SpendingAlert.id == alert_id))
    alert = result.scalar_one_or_none()
    if alert:
        await db.delete(alert)
        await db.commit()
    return {"status": "ok"}


@router.get("/check/{year}/{month}")
async def check_alerts(year: int, month: int, db: AsyncSession = Depends(get_session)):
    """Return all enabled alerts with their current pct_used and whether they're triggered."""
    # Load all enabled alerts
    result = await db.execute(select(SpendingAlert).where(SpendingAlert.enabled == True))
    alerts = result.scalars().all()
    if not alerts:
        return []

    # Load budget month
    bm_result = await db.execute(
        select(BudgetMonth).where(BudgetMonth.year == year, BudgetMonth.month == month)
    )
    bm = bm_result.scalar_one_or_none()
    if not bm:
        return []

    # Build category_id → (name, budgeted) map
    cat_ids = [str(a.category_id) for a in alerts]
    cats_result = await db.execute(select(BudgetCategory).where(BudgetCategory.id.in_(cat_ids)))
    cats = {str(c.id): c for c in cats_result.scalars().all()}

    # Sum spending per category for the month
    from datetime import date
    import calendar as cal
    first_day = date(year, month, 1)
    last_day = date(year, month, cal.monthrange(year, month)[1])

    spent_result = await db.execute(
        select(Transaction.budget_category_id, Transaction.amount).where(
            Transaction.budget_category_id.in_(cat_ids),
            Transaction.date >= first_day,
            Transaction.date <= last_day,
            Transaction.pending == False,
            Transaction.amount > 0,
        )
    )
    spent_map: dict[str, float] = {}
    for row in spent_result:
        key = str(row.budget_category_id)
        spent_map[key] = spent_map.get(key, 0.0) + float(row.amount)

    out = []
    for alert in alerts:
        cid = str(alert.category_id)
        cat = cats.get(cid)
        if not cat:
            continue
        budgeted = float(cat.budgeted)
        spent = spent_map.get(cid, 0.0)
        pct_used = round((spent / budgeted * 100) if budgeted > 0 else 0, 1)
        out.append({
            "alert_id": str(alert.id),
            "category_id": cid,
            "category_name": cat.name,
            "threshold_pct": alert.threshold_pct,
            "budgeted": budgeted,
            "spent": round(spent, 2),
            "pct_used": pct_used,
            "triggered": pct_used >= alert.threshold_pct,
        })
    return out
