"""Bill payment tracking routes."""
from __future__ import annotations

import calendar
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select, and_, delete
from sqlalchemy.ext.asyncio import AsyncSession

from api.auth import get_current_user
from backend.db.base import get_session
from backend.db.models import BillPayment, BudgetCategory, BudgetGroup, BudgetMonth
from api.routes.subscriptions import get_merged_subscriptions

router = APIRouter(prefix="/api/v1/bills", tags=["bills"])


@router.get("/paid")
async def get_paid_bills(year: int = Query(...), month: int = Query(...), user_id: str = Depends(get_current_user), db: AsyncSession = Depends(get_session)):
    result = await db.execute(
        select(BillPayment).where(and_(BillPayment.user_id == user_id, BillPayment.year == year, BillPayment.month == month))
    )
    payments = result.scalars().all()
    return [
        {
            "merchant_name": p.merchant_name,
            "paid": p.paid,
            "paid_on": p.paid_on.isoformat() if p.paid_on else None,
            "notes": p.notes,
        }
        for p in payments
    ]


class MarkPaidRequest(BaseModel):
    merchant_name: str
    year: int
    month: int
    paid_on: Optional[date] = None
    notes: Optional[str] = None


@router.post("/paid")
async def mark_paid(body: MarkPaidRequest, user_id: str = Depends(get_current_user), db: AsyncSession = Depends(get_session)):
    result = await db.execute(
        select(BillPayment).where(
            and_(
                BillPayment.user_id == user_id,
                BillPayment.merchant_name == body.merchant_name,
                BillPayment.year == body.year,
                BillPayment.month == body.month,
            )
        )
    )
    payment = result.scalar_one_or_none()
    if payment:
        payment.paid = True
        payment.paid_on = body.paid_on or date.today()
        payment.notes = body.notes
        payment.updated_at = datetime.utcnow()
    else:
        payment = BillPayment(
            user_id=user_id,
            merchant_name=body.merchant_name,
            year=body.year,
            month=body.month,
            paid=True,
            paid_on=body.paid_on or date.today(),
            notes=body.notes,
        )
        db.add(payment)
    await db.commit()
    return {"status": "ok"}


@router.get("/upcoming")
async def get_upcoming_unpaid(days_ahead: int = Query(default=7, ge=1, le=90), user_id: str = Depends(get_current_user), db: AsyncSession = Depends(get_session)):
    """Return bills due in the next N days that haven't been marked paid. Sourced
    Two sources, merged:
      - detected/manual subscriptions (the Subscriptions page list), so pausing,
        cancelling, hiding, or editing one is reflected here immediately; and
      - budget categories carrying a due_date_day (rent, utilities, a car
        payment), which are the bills people actually plan but that no
        recurring-transaction detector will find.
    A budget category whose name matches a subscription is skipped so the same
    bill isn't counted twice."""
    today = date.today()
    cutoff = today + timedelta(days=days_ahead)
    year, month = today.year, today.month

    subs = await get_merged_subscriptions(user_id, db, months_back=6)

    result = await db.execute(
        select(BillPayment).where(and_(BillPayment.user_id == user_id, BillPayment.year == year, BillPayment.month == month, BillPayment.paid == True))
    )
    paid_merchants = {p.merchant_name for p in result.scalars().all()}

    upcoming = []
    for sub in subs:
        if sub.get("status") in ("cancelled", "paused"):
            continue
        merchant = sub["merchant"]
        if merchant in paid_merchants:
            continue
        expected_days = sub.get("expected_days") or 30
        try:
            bill_date = date.fromisoformat(sub["next_expected"])
        except Exception:
            continue
        # Roll a stale next_expected forward to the next occurrence on/after today,
        # honoring the subscription's actual cadence (weekly, monthly, etc.).
        while bill_date < today:
            bill_date += timedelta(days=expected_days)
        if today <= bill_date <= cutoff:
            upcoming.append({
                "merchant": merchant,
                "amount": sub.get("amount", 0),
                "due_date": bill_date.isoformat(),
                "days_until": (bill_date - today).days,
            })

    # --- Budgeted bills with a due date -----------------------------------
    seen = {u["merchant"].strip().lower() for u in upcoming}
    bm_result = await db.execute(
        select(BudgetCategory, BudgetGroup.name)
        .join(BudgetGroup, BudgetCategory.group_id == BudgetGroup.id)
        .join(BudgetMonth, BudgetGroup.budget_month_id == BudgetMonth.id)
        .where(
            BudgetMonth.user_id == user_id,
            BudgetMonth.year == year, BudgetMonth.month == month,
            BudgetCategory.due_date_day.isnot(None),
            BudgetCategory.budgeted > 0,
        )
    )
    for cat, group_name in bm_result.all():
        if group_name == "Income":
            continue
        name = cat.name
        if name.strip().lower() in seen or name in paid_merchants:
            continue
        # A day-of-month repeats, so walk forward month by month to the next
        # occurrence at or after today, clamping to months that are shorter
        # than the chosen day (the 31st in a 30-day month bills on the 30th).
        day = max(1, min(int(cat.due_date_day), 31))
        y, m = today.year, today.month
        bill_date = None
        for _ in range(4):
            last_day = calendar.monthrange(y, m)[1]
            candidate = date(y, m, min(day, last_day))
            if candidate >= today:
                bill_date = candidate
                break
            m += 1
            if m > 12:
                m = 1
                y += 1
        if bill_date is None or bill_date > cutoff:
            continue
        upcoming.append({
            "merchant": name,
            "amount": float(cat.budgeted),
            "due_date": bill_date.isoformat(),
            "days_until": (bill_date - today).days,
            "source": "budget",
        })

    upcoming.sort(key=lambda x: x["due_date"])
    return upcoming


@router.delete("/paid")
async def mark_unpaid(merchant_name: str = Query(...), year: int = Query(...), month: int = Query(...), user_id: str = Depends(get_current_user), db: AsyncSession = Depends(get_session)):
    await db.execute(
        delete(BillPayment).where(
            and_(
                BillPayment.user_id == user_id,
                BillPayment.merchant_name == merchant_name,
                BillPayment.year == year,
                BillPayment.month == month,
            )
        )
    )
    await db.commit()
    return {"status": "ok"}
