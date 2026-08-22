"""Cash-flow forecast: project the next 30 days of cash, day by day.

starting cash (checking/savings/cash available balances)
+ scheduled paychecks   (paychecks/upcoming)
− unpaid upcoming bills (bills/upcoming)
= projected balance per day, flagging any day that dips negative.
"""
from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.auth import get_current_user
from backend.db.base import get_session
from backend.db.models import BankAccount
from api.routes.bills import get_upcoming_unpaid
from api.routes.paychecks import get_upcoming as get_upcoming_paychecks

router = APIRouter(prefix="/api/v1/cashflow", tags=["cashflow"])


@router.get("/forecast")
async def get_forecast(days: int = Query(default=30, ge=7, le=30), user_id: str = Depends(get_current_user), db: AsyncSession = Depends(get_session)):
    today = date.today()

    result = await db.execute(
        select(BankAccount).where(BankAccount.user_id == user_id, BankAccount.is_active == True, BankAccount.type == "depository")  # noqa: E712
    )
    cash = 0.0
    for a in result.scalars().all():
        bal = a.available_balance if a.available_balance is not None else a.current_balance
        cash += float(bal or 0)

    bills = await get_upcoming_unpaid(days_ahead=days, user_id=user_id, db=db)
    paychecks = await get_upcoming_paychecks(days_ahead=days, user_id=user_id, db=db)

    by_day: dict[str, dict] = {}
    for offset in range(days + 1):
        d = (today + timedelta(days=offset)).isoformat()
        by_day[d] = {"date": d, "in": 0.0, "out": 0.0, "events": []}

    for p in paychecks:
        d = p["date"]
        if d in by_day:
            by_day[d]["in"] += p["amount"]
            by_day[d]["events"].append({"type": "paycheck", "name": p["source"], "amount": p["amount"]})

    for b in bills:
        d = b["due_date"]
        if d in by_day:
            by_day[d]["out"] += b["amount"]
            by_day[d]["events"].append({"type": "bill", "name": b["merchant"], "amount": b["amount"]})

    days_out = []
    balance = cash
    min_balance = cash
    min_date = today.isoformat()
    first_negative: str | None = None
    for offset in range(days + 1):
        d = (today + timedelta(days=offset)).isoformat()
        entry = by_day[d]
        balance += entry["in"] - entry["out"]
        entry["balance"] = round(balance, 2)
        if balance < min_balance:
            min_balance = balance
            min_date = d
        if balance < 0 and first_negative is None:
            first_negative = d
        days_out.append(entry)

    return {
        "starting_cash": round(cash, 2),
        "ending_balance": round(balance, 2),
        "min_balance": round(min_balance, 2),
        "min_date": min_date,
        "first_negative_date": first_negative,
        "days": days_out,
    }
