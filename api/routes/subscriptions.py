"""Subscription manager routes — overlays user status on top of recurring detection,
and lets users manually add subscriptions that transaction-pattern detection wouldn't
otherwise catch (e.g. cash-paid, annual, or not-yet-billed)."""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db.base import get_session
from backend.db.models import UserSubscription
from backend.services.recurring_service import detect_recurring

router = APIRouter(prefix="/api/v1/subscriptions", tags=["subscriptions"])

_CADENCE_DAYS = {"weekly": 7, "biweekly": 14, "monthly": 30, "quarterly": 91, "annual": 365}


class SubscriptionUpdate(BaseModel):
    status: Optional[str] = None
    notes: Optional[str] = None
    cadence: Optional[str] = None


def _apply_cadence_override(item: dict, override: Optional[UserSubscription]) -> dict:
    """Apply a user-chosen cadence override on top of a detected pattern, recomputing
    the days-per-occurrence and annual cost estimate to match."""
    if not override or not override.cadence or override.cadence == item["cadence"]:
        return item
    expected_days = _CADENCE_DAYS[override.cadence]
    return {
        **item,
        "cadence": override.cadence,
        "expected_days": expected_days,
        "annual_cost": round(item["amount"] * (365 / expected_days), 2),
    }


def _manual_to_dict(sub: UserSubscription) -> dict:
    expected_days = _CADENCE_DAYS.get(sub.cadence or "monthly", 30)
    amount = float(sub.amount or 0)
    return {
        "merchant": sub.merchant_name,
        "cadence": sub.cadence or "monthly",
        "expected_days": expected_days,
        "amount": amount,
        "annual_cost": round(amount * (365 / expected_days), 2),
        "occurrences": 0,
        "last_seen": None,
        "next_expected": (sub.next_expected or date.today()).isoformat(),
        "budget_category_id": None,
        "status": sub.status,
        "notes": sub.notes,
        "is_manual": True,
    }


async def get_merged_subscriptions(db: AsyncSession, months_back: int = 6) -> list[dict]:
    """Detected recurring transactions merged with user overrides (status, notes,
    cadence), plus manually-added subscriptions — with hidden/removed entries
    excluded. This is the single source of truth for "what is a live subscription
    right now" — anything that reads subscriptions/bills should go through this so
    edits (cadence changes, pauses, deletes, manual additions) are reflected
    everywhere consistently, not just on the subscriptions page."""
    detected = await detect_recurring(db, months_back)

    result = await db.execute(select(UserSubscription))
    overrides: dict[str, UserSubscription] = {u.merchant_name: u for u in result.scalars().all()}

    out = []
    detected_merchants = set()
    for item in detected:
        merchant = item["merchant"]
        detected_merchants.add(merchant)
        override = overrides.get(merchant)
        if override and override.hidden:
            continue
        out.append({
            **_apply_cadence_override(item, override),
            "status": override.status if override else "active",
            "notes": override.notes if override else None,
            "is_manual": False,
        })

    for merchant, sub in overrides.items():
        if sub.is_manual and merchant not in detected_merchants and not sub.hidden:
            out.append(_manual_to_dict(sub))

    return out


@router.get("/")
async def list_subscriptions(months_back: int = 6, db: AsyncSession = Depends(get_session)):
    return await get_merged_subscriptions(db, months_back)


class SubscriptionCreate(BaseModel):
    merchant: str
    amount: float
    cadence: str = "monthly"
    next_expected: Optional[date] = None
    notes: Optional[str] = None


@router.post("/")
async def create_subscription(body: SubscriptionCreate, db: AsyncSession = Depends(get_session)):
    """Manually add a subscription that recurring detection wouldn't otherwise find."""
    if body.cadence not in _CADENCE_DAYS:
        raise HTTPException(status_code=400, detail=f"cadence must be one of {list(_CADENCE_DAYS)}")
    merchant = body.merchant.strip()
    if not merchant:
        raise HTTPException(status_code=400, detail="merchant is required")

    result = await db.execute(select(UserSubscription).where(UserSubscription.merchant_name == merchant))
    sub = result.scalar_one_or_none()
    if sub is None:
        sub = UserSubscription(merchant_name=merchant)
        db.add(sub)
    sub.is_manual = True
    sub.hidden = False
    sub.amount = body.amount
    sub.cadence = body.cadence
    sub.next_expected = body.next_expected or (date.today() + timedelta(days=_CADENCE_DAYS[body.cadence]))
    if body.notes is not None:
        sub.notes = body.notes
    sub.status = sub.status or "active"
    sub.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(sub)
    return _manual_to_dict(sub)


@router.patch("/{merchant_name:path}")
async def update_subscription(merchant_name: str, body: SubscriptionUpdate, db: AsyncSession = Depends(get_session)):
    """Create or update the user's status/notes/cadence override for a subscription."""
    if body.cadence is not None and body.cadence not in _CADENCE_DAYS:
        raise HTTPException(status_code=400, detail=f"cadence must be one of {list(_CADENCE_DAYS)}")
    result = await db.execute(select(UserSubscription).where(UserSubscription.merchant_name == merchant_name))
    sub = result.scalar_one_or_none()
    if sub is None:
        sub = UserSubscription(merchant_name=merchant_name)
        db.add(sub)
    if body.status is not None:
        sub.status = body.status
    if body.notes is not None:
        sub.notes = body.notes
    if body.cadence is not None:
        sub.cadence = body.cadence
    sub.updated_at = datetime.utcnow()
    await db.commit()
    return {"status": sub.status, "notes": sub.notes, "cadence": sub.cadence}


@router.delete("/{merchant_name:path}")
async def remove_subscription(merchant_name: str, db: AsyncSession = Depends(get_session)):
    """Remove a subscription by hiding it — this keeps it recoverable via the
    'recently deleted' list instead of losing the record outright."""
    result = await db.execute(select(UserSubscription).where(UserSubscription.merchant_name == merchant_name))
    sub = result.scalar_one_or_none()
    if sub is None:
        sub = UserSubscription(merchant_name=merchant_name)
        db.add(sub)
    sub.hidden = True
    sub.updated_at = datetime.utcnow()
    await db.commit()
    return {"status": "ok"}


@router.get("/deleted")
async def list_deleted_subscriptions(months_back: int = 6, db: AsyncSession = Depends(get_session)):
    """Return subscriptions the user has removed, so they can be restored."""
    detected = await detect_recurring(db, months_back)
    detected_by_merchant = {item["merchant"]: item for item in detected}

    result = await db.execute(select(UserSubscription).where(UserSubscription.hidden == True))  # noqa: E712
    hidden = result.scalars().all()

    out = []
    for sub in hidden:
        item = detected_by_merchant.get(sub.merchant_name)
        if item:
            out.append({**_apply_cadence_override(item, sub), "status": sub.status, "notes": sub.notes, "is_manual": False})
        elif sub.is_manual:
            out.append(_manual_to_dict(sub))
        # Otherwise: hidden override with no detected pattern and not manual —
        # stale record (e.g. transactions aged out); nothing to show/restore.
    return out


@router.post("/{merchant_name:path}/restore")
async def restore_subscription(merchant_name: str, db: AsyncSession = Depends(get_session)):
    """Unhide a previously-removed subscription."""
    result = await db.execute(select(UserSubscription).where(UserSubscription.merchant_name == merchant_name))
    sub = result.scalar_one_or_none()
    if sub is None or not sub.hidden:
        raise HTTPException(status_code=404, detail="No deleted subscription found for that merchant")
    sub.hidden = False
    sub.updated_at = datetime.utcnow()
    await db.commit()
    return {"status": "ok"}
