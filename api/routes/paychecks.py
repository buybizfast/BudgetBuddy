"""Recurring paycheck scheduling routes."""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

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
async def list_paychecks(db: AsyncSession = Depends(get_session)):
    result = await db.execute(select(Paycheck).order_by(Paycheck.next_date))
    return [_serialize(p) for p in result.scalars().all()]


@router.get("/occurrences")
async def list_occurrence_overrides(db: AsyncSession = Depends(get_session)):
    """Return all per-occurrence overrides, for clients that compute schedule
    dates locally and need to merge in any edited amount/name."""
    result = await db.execute(select(PaycheckOccurrenceOverride))
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
async def create_paycheck(body: PaycheckRequest, db: AsyncSession = Depends(get_session)):
    if body.frequency not in ("weekly", "biweekly", "semimonthly", "monthly"):
        raise HTTPException(status_code=400, detail="Invalid frequency")
    paycheck = Paycheck(
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
async def update_paycheck(paycheck_id: str, body: PaycheckUpdateRequest, db: AsyncSession = Depends(get_session)):
    result = await db.execute(select(Paycheck).where(Paycheck.id == paycheck_id))
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
async def delete_paycheck(paycheck_id: str, db: AsyncSession = Depends(get_session)):
    result = await db.execute(select(Paycheck).where(Paycheck.id == paycheck_id))
    paycheck = result.scalar_one_or_none()
    if not paycheck:
        raise HTTPException(status_code=404, detail="Paycheck not found")
    await db.delete(paycheck)
    await db.commit()
    return {"status": "ok"}


@router.get("/upcoming")
async def get_upcoming(days_ahead: int = Query(default=30, ge=1, le=90), db: AsyncSession = Depends(get_session)):
    """Return individual paycheck occurrences within the next N days, advancing
    each schedule's stored next_date forward as occurrences pass."""
    today = date.today()
    cutoff = today + timedelta(days=days_ahead)

    result = await db.execute(select(Paycheck).where(Paycheck.active == True))  # noqa: E712
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
    db: AsyncSession = Depends(get_session),
):
    """Edit the amount/name of a single generated paycheck occurrence,
    without affecting the recurring schedule or other occurrences."""
    result = await db.execute(select(Paycheck).where(Paycheck.id == paycheck_id))
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
async def revert_occurrence(paycheck_id: str, occurrence_date: date, db: AsyncSession = Depends(get_session)):
    """Remove a per-occurrence override, reverting it back to the schedule's defaults."""
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
