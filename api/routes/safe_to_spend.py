"""Safe to Spend — what's actually free to spend right now.

cash on hand (checking/savings/manual cash)
− bills due before the next paycheck (unpaid, from the merged subscription list)
= safe to spend
"""
from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.auth import get_current_user
from backend.db.base import get_session
from backend.db.models import BankAccount, Paycheck
from api.routes.bills import get_upcoming_unpaid

router = APIRouter(prefix="/api/v1/safe-to-spend", tags=["safe-to-spend"])


@router.get("/")
async def get_safe_to_spend(user_id: str = Depends(get_current_user), db: AsyncSession = Depends(get_session)):
    today = date.today()

    # Cash on hand: active checking/savings/cash accounts. "available" is the
    # live figure (excludes pending holds); fall back to current when the bank
    # doesn't report it.
    result = await db.execute(
        select(BankAccount).where(BankAccount.user_id == user_id, BankAccount.is_active == True, BankAccount.type == "depository")  # noqa: E712
    )
    accounts = result.scalars().all()
    cash = 0.0
    for a in accounts:
        bal = a.available_balance if a.available_balance is not None else a.current_balance
        cash += float(bal or 0)

    # Horizon: the next paycheck date, else 30 days out. Bills due after the
    # next paycheck can be covered by that paycheck, so they don't reduce
    # what's safe to spend today.
    result = await db.execute(select(Paycheck).where(Paycheck.user_id == user_id, Paycheck.active == True))  # noqa: E712
    next_paycheck: date | None = None
    for p in result.scalars().all():
        d = p.next_date
        # next_date may be stale; roll forward without persisting (the
        # paychecks/upcoming route owns catching it up).
        from api.routes.paychecks import _advance
        while d < today:
            d = _advance(d, p.frequency)
        if next_paycheck is None or d < next_paycheck:
            next_paycheck = d

    horizon_days = (next_paycheck - today).days if next_paycheck else 30
    horizon_days = max(1, min(30, horizon_days))

    bills = await get_upcoming_unpaid(days_ahead=horizon_days, user_id=user_id, db=db)
    bills_total = sum(b["amount"] for b in bills)

    safe = cash - bills_total
    return {
        "safe_to_spend": round(safe, 2),
        "cash": round(cash, 2),
        "upcoming_bills_total": round(bills_total, 2),
        "upcoming_bills_count": len(bills),
        "next_paycheck_date": next_paycheck.isoformat() if next_paycheck else None,
        "horizon_days": horizon_days,
    }
