"""Recurring paycheck scheduling routes."""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.auth import get_current_user
from backend.db.base import get_session
from backend.db.models import Paycheck, PaycheckOccurrenceOverride

router = APIRouter(prefix="/api/v1/paychecks", tags=["paychecks"])

_STEP_DAYS = {"weekly": 7, "biweekly": 14, "monthly": 30, "semimonthly": 15}


def _advance(d: date, frequency: str) -> date:
    """Return the next occurrence after d for a given frequency."""
    if frequency == "monthly":
        year = d.year + (1 if d.month == 12 else 0)
        month = 1 if d.month == 12 else d.month + 1
        day = min(d.day, 28) if month == 2 else d.day
        return date(year, month, day)
    return d + timedelta(days=_STEP_DAYS.get(frequency, 14))


def _serialize(p: Paycheck) -> dict:
    return {
        "id": p.id,
        "source": p.source,
        "amount": float(p.amount),
        "frequency": p.frequency,
        "next_date": p.next_date.isoformat(),
        "active": p.active,
    }


@router.get("/")
async def list_paychecks(user_id: str = Depends(get_current_user), db: AsyncSession = Depends(get_session)):
    result = await db.execute(select(Paycheck).where(Paycheck.user_id == user_id).order_by(Paycheck.next_date))
    return [_serialize(p) for p in result.scalars().all()]


@router.get("/occurrences")
async def list_occurrence_overrides(user_id: str = Depends(get_current_user), db: AsyncSession = Depends(get_session)):
    """Return all per-occurrence overrides, for clients that compute schedule
    dates locally and need to merge in any edited amount/name."""
    result = await db.execute(
        select(PaycheckOccurrenceOverride).join(Paycheck, PaycheckOccurrenceOverride.paycheck_id == Paycheck.id)
        .where(Paycheck.user_id == user_id)
    )
    return [
        {
            "id": o.id,
            "paycheck_id": o.paycheck_id,
            "occurrence_date": o.occurrence_date.isoformat(),
            "source": o.source,
            "amount": float(o.amount) if o.amount is not None else None,
        }
        for o in result.scalars().all()
    ]


class PaycheckRequest(BaseModel):
    source: str
    amount: float
    frequency: str = "biweekly"
    next_date: date
    active: bool = True


@router.post("/")
async def create_paycheck(body: PaycheckRequest, user_id: str = Depends(get_current_user), db: AsyncSession = Depends(get_session)):
    if body.frequency not in ("weekly", "biweekly", "semimonthly", "monthly"):
        raise HTTPException(status_code=400, detail="Invalid frequency")
    paycheck = Paycheck(
        user_id=user_id,
        source=body.source.strip(),
        amount=body.amount,
        frequency=body.frequency,
        next_date=body.next_date,
        active=body.active,
    )
    db.add(paycheck)
    await db.commit()
    await db.refresh(paycheck)
    return _serialize(paycheck)


class PaycheckUpdateRequest(BaseModel):
    source: Optional[str] = None
    amount: Optional[float] = None
    frequency: Optional[str] = None
    next_date: Optional[date] = None
    active: Optional[bool] = None


@router.patch("/{paycheck_id}")
async def update_paycheck(paycheck_id: str, body: PaycheckUpdateRequest, user_id: str = Depends(get_current_user), db: AsyncSession = Depends(get_session)):
    result = await db.execute(select(Paycheck).where(Paycheck.id == paycheck_id, Paycheck.user_id == user_id))
    paycheck = result.scalar_one_or_none()
    if not paycheck:
        raise HTTPException(status_code=404, detail="Paycheck not found")
    if body.source is not None:
        paycheck.source = body.source.strip()
    if body.amount is not None:
        paycheck.amount = body.amount
    if body.frequency is not None:
        if body.frequency not in ("weekly", "biweekly", "semimonthly", "monthly"):
            raise HTTPException(status_code=400, detail="Invalid frequency")
        paycheck.frequency = body.frequency
    if body.next_date is not None:
        paycheck.next_date = body.next_date
    if body.active is not None:
        paycheck.active = body.active
    paycheck.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(paycheck)
    return _serialize(paycheck)


@router.delete("/{paycheck_id}")
async def delete_paycheck(paycheck_id: str, user_id: str = Depends(get_current_user), db: AsyncSession = Depends(get_session)):
    result = await db.execute(select(Paycheck).where(Paycheck.id == paycheck_id, Paycheck.user_id == user_id))
    paycheck = result.scalar_one_or_none()
    if not paycheck:
        raise HTTPException(status_code=404, detail="Paycheck not found")
    await db.delete(paycheck)
    await db.commit()
    return {"status": "ok"}


@router.get("/upcoming")
async def get_upcoming(days_ahead: int = Query(default=30, ge=1, le=90), user_id: str = Depends(get_current_user), db: AsyncSession = Depends(get_session)):
    """Return individual paycheck occurrences within the next N days, advancing
    each schedule's stored next_date forward as occurrences pass."""
    today = date.today()
    cutoff = today + timedelta(days=days_ahead)

    result = await db.execute(select(Paycheck).where(Paycheck.user_id == user_id, Paycheck.active == True))  # noqa: E712
    paychecks = result.scalars().all()

    overrides_by_paycheck: dict[str, dict[date, PaycheckOccurrenceOverride]] = {}
    if paychecks:
        override_result = await db.execute(
            select(PaycheckOccurrenceOverride).where(
                PaycheckOccurrenceOverride.paycheck_id.in_([p.id for p in paychecks])
            )
        )
        for o in override_result.scalars().all():
            overrides_by_paycheck.setdefault(o.paycheck_id, {})[o.occurrence_date] = o

    upcoming = []
    for p in paychecks:
        occurrence = p.next_date
        overrides = overrides_by_paycheck.get(p.id, {})
        # Catch up any past-due occurrences so next_date stays current.
        advanced = False
        while occurrence < today:
            occurrence = _advance(occurrence, p.frequency)
            advanced = True
        if advanced:
            p.next_date = occurrence

        while occurrence <= cutoff:
            override = overrides.get(occurrence)
            upcoming.append({
                "id": p.id,
                "paycheck_id": p.id,
                "occurrence_date": occurrence.isoformat(),
                "source": override.source if (override and override.source is not None) else p.source,
                "amount": float(override.amount) if (override and override.amount is not None) else float(p.amount),
                "date": occurrence.isoformat(),
                "days_until": (occurrence - today).days,
                "edited": override is not None,
            })
            occurrence = _advance(occurrence, p.frequency)

    if any(p.next_date for p in paychecks):
        await db.commit()

    upcoming.sort(key=lambda x: x["date"])
    return upcoming


class OccurrenceUpdateRequest(BaseModel):
    source: Optional[str] = None
    amount: Optional[float] = None


def _serialize_occurrence(o: PaycheckOccurrenceOverride, p: Paycheck) -> dict:
    return {
        "id": o.id,
        "paycheck_id": p.id,
        "occurrence_date": o.occurrence_date.isoformat(),
        "date": o.occurrence_date.isoformat(),
        "source": o.source if o.source is not None else p.source,
        "amount": float(o.amount) if o.amount is not None else float(p.amount),
        "edited": True,
    }


@router.patch("/{paycheck_id}/occurrences/{occurrence_date}")
async def update_occurrence(
    paycheck_id: str,
    occurrence_date: date,
    body: OccurrenceUpdateRequest,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Edit the amount/name of a single generated paycheck occurrence,
    without affecting the recurring schedule or other occurrences."""
    result = await db.execute(select(Paycheck).where(Paycheck.id == paycheck_id, Paycheck.user_id == user_id))
    paycheck = result.scalar_one_or_none()
    if not paycheck:
        raise HTTPException(status_code=404, detail="Paycheck not found")

    result = await db.execute(
        select(PaycheckOccurrenceOverride).where(
            PaycheckOccurrenceOverride.paycheck_id == paycheck_id,
            PaycheckOccurrenceOverride.occurrence_date == occurrence_date,
        )
    )
    override = result.scalar_one_or_none()
    if not override:
        override = PaycheckOccurrenceOverride(paycheck_id=paycheck_id, occurrence_date=occurrence_date)
        db.add(override)

    if body.source is not None:
        override.source = body.source.strip()
    if body.amount is not None:
        override.amount = body.amount
    override.updated_at = datetime.utcnow()

    await db.commit()
    await db.refresh(override)
    return _serialize_occurrence(override, paycheck)


@router.delete("/{paycheck_id}/occurrences/{occurrence_date}")
async def revert_occurrence(paycheck_id: str, occurrence_date: date, user_id: str = Depends(get_current_user), db: AsyncSession = Depends(get_session)):
    """Remove a per-occurrence override, reverting it back to the schedule's defaults."""
    result = await db.execute(select(Paycheck).where(Paycheck.id == paycheck_id, Paycheck.user_id == user_id))
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Paycheck not found")
    result = await db.execute(
        select(PaycheckOccurrenceOverride).where(
            PaycheckOccurrenceOverride.paycheck_id == paycheck_id,
            PaycheckOccurrenceOverride.occurrence_date == occurrence_date,
        )
    )
    override = result.scalar_one_or_none()
    if not override:
        raise HTTPException(status_code=404, detail="Override not found")
    await db.delete(override)
    await db.commit()
    return {"status": "ok"}


@router.get("/periods")
async def get_pay_periods(
    days_ahead: int = Query(default=60, ge=14, le=90),
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Bills grouped by the paycheck that has to cover them.

    Paychecks landing on the same day are one pay period, not several: they're
    a single deposit event from the budget's point of view, and treating them
    separately produced periods that ended before they began (period N ends the
    day before the next paycheck, which for a same-day paycheck is yesterday),
    leaving empty cards while the last one absorbed every bill.

    A period therefore runs from one pay DATE up to the day before the next
    distinct pay date, and reports every income source arriving that day.
    """
    from api.routes.bills import get_upcoming_unpaid

    today = date.today()
    paychecks = await get_upcoming(days_ahead=days_ahead, user_id=user_id, db=db)
    bills = await get_upcoming_unpaid(days_ahead=days_ahead, user_id=user_id, db=db)

    if not paychecks:
        return {
            "periods": [],
            "unassigned_bills": bills,
            "unassigned_total": round(sum(b["amount"] for b in bills), 2),
            "message": "Add a paycheck schedule to group bills by payday.",
            "today": today.isoformat(),
        }

    # Collapse to one entry per pay date, keeping each source that arrives then.
    by_date: dict[str, dict] = {}
    for p in paychecks:
        entry = by_date.setdefault(p["date"], {
            "pay_date": p["date"],
            "days_until": p["days_until"],
            "amount": 0.0,
            "sources": [],
            "bills": [],
        })
        entry["amount"] += p["amount"]
        entry["sources"].append({
            "paycheck_id": p["paycheck_id"],
            "source": p["source"],
            "amount": p["amount"],
        })

    periods = [by_date[d] for d in sorted(by_date)]
    for idx, period in enumerate(periods):
        start = date.fromisoformat(period["pay_date"])
        end = (
            date.fromisoformat(periods[idx + 1]["pay_date"]) - timedelta(days=1)
            if idx + 1 < len(periods)
            else start + timedelta(days=days_ahead)
        )
        period["period_start"] = start.isoformat()
        period["period_end"] = end.isoformat()
        period["amount"] = round(period["amount"], 2)

    # Bills before the first paycheck aren't covered by any of them — they come
    # out of money already banked, so report them separately.
    first_pay = date.fromisoformat(periods[0]["pay_date"])
    unassigned = []
    for b in bills:
        due = date.fromisoformat(b["due_date"])
        if due < first_pay:
            unassigned.append(b)
            continue
        for period in periods:
            if date.fromisoformat(period["period_start"]) <= due <= date.fromisoformat(period["period_end"]):
                period["bills"].append(b)
                break

    for period in periods:
        period["bills"].sort(key=lambda b: b["due_date"])
        bills_total = sum(b["amount"] for b in period["bills"])
        period["bills_total"] = round(bills_total, 2)
        period["leftover"] = round(period["amount"] - bills_total, 2)
        period["bill_count"] = len(period["bills"])

    return {
        "periods": periods,
        "unassigned_bills": unassigned,
        "unassigned_total": round(sum(b["amount"] for b in unassigned), 2),
        "today": today.isoformat(),
    }
