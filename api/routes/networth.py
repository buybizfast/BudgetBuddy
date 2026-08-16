"""Net worth tracking routes."""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db.base import get_session
from backend.db.models import BankAccount, DebtAccount, NetWorthSnapshot, SavingsGoal

router = APIRouter(prefix="/api/v1/networth", tags=["networth"])


async def _current_snapshot(db: AsyncSession) -> dict:
    """Compute current net worth from live balances."""
    accounts = (await db.execute(select(BankAccount).where(BankAccount.is_active == True))).scalars().all()
    debts = (await db.execute(select(DebtAccount).where(DebtAccount.is_paid_off == False))).scalars().all()
    goals = (await db.execute(select(SavingsGoal).where(SavingsGoal.is_completed == False))).scalars().all()

    # Credit/loan accounts' current_balance represents what's owed, not an
    # asset — they're already counted in `liabilities` via DebtAccount below.
    # Filtering by type (not just "balance > 0") avoids double-counting them
    # as both an asset and a liability.
    bank_assets = sum(float(a.current_balance) for a in accounts if a.type not in ("credit", "loan"))
    savings_assets = sum(float(g.current_amount) for g in goals)
    assets = bank_assets + savings_assets
    liabilities = sum(float(d.balance) for d in debts)
    return {"assets": round(assets, 2), "liabilities": round(liabilities, 2), "net_worth": round(assets - liabilities, 2)}


@router.get("/current")
async def get_current(db: AsyncSession = Depends(get_session)):
    snap = await _current_snapshot(db)
    now = datetime.utcnow()
    snap["year"] = now.year
    snap["month"] = now.month
    return snap


@router.get("/history")
async def get_history(db: AsyncSession = Depends(get_session)):
    result = await db.execute(
        select(NetWorthSnapshot).order_by(NetWorthSnapshot.year, NetWorthSnapshot.month)
    )
    snapshots = result.scalars().all()
    return [
        {
            "year": s.year, "month": s.month,
            "assets": float(s.assets), "liabilities": float(s.liabilities),
            "net_worth": float(s.net_worth),
        }
        for s in snapshots
    ]


@router.post("/snapshot")
async def save_snapshot(db: AsyncSession = Depends(get_session)):
    """Save current net worth as this month's snapshot."""
    snap = await _current_snapshot(db)
    now = datetime.utcnow()
    year, month = now.year, now.month

    result = await db.execute(
        select(NetWorthSnapshot).where(NetWorthSnapshot.year == year, NetWorthSnapshot.month == month)
    )
    existing = result.scalar_one_or_none()
    if existing:
        existing.assets = snap["assets"]
        existing.liabilities = snap["liabilities"]
        existing.net_worth = snap["net_worth"]
    else:
        db.add(NetWorthSnapshot(year=year, month=month, **snap))
    await db.commit()
    return {**snap, "year": year, "month": month}
