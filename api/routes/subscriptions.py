"""Subscription manager routes — overlays user status on top of recurring detection."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db.base import get_session
from backend.db.models import UserSubscription
from backend.services.recurring_service import detect_recurring
from datetime import datetime

router = APIRouter(prefix="/api/v1/subscriptions", tags=["subscriptions"])


class SubscriptionUpdate(BaseModel):
    status: str | None = None
    notes: str | None = None


@router.get("/")
async def list_subscriptions(months_back: int = 6, db: AsyncSession = Depends(get_session)):
    """Return detected recurring transactions merged with any user-saved status overrides."""
    detected = await detect_recurring(db, months_back)

    # Load all user overrides
    result = await db.execute(select(UserSubscription))
    overrides: dict[str, UserSubscription] = {u.merchant_name: u for u in result.scalars().all()}

    out = []
    for item in detected:
        merchant = item["merchant"]
        override = overrides.get(merchant)
        out.append({
            **item,
            "status": override.status if override else "active",
            "notes": override.notes if override else None,
        })
    return out


@router.patch("/{merchant_name:path}")
async def update_subscription(merchant_name: str, body: SubscriptionUpdate, db: AsyncSession = Depends(get_session)):
    """Create or update the user's status override for a subscription."""
    result = await db.execute(select(UserSubscription).where(UserSubscription.merchant_name == merchant_name))
    sub = result.scalar_one_or_none()
    if sub is None:
        sub = UserSubscription(merchant_name=merchant_name)
        db.add(sub)
    if body.status is not None:
        sub.status = body.status
    if body.notes is not None:
        sub.notes = body.notes
    sub.updated_at = datetime.utcnow()
    await db.commit()
    return {"status": sub.status, "notes": sub.notes}
