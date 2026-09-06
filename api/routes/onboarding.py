"""Onboarding checklist — reports how far a new user is through initial setup,
so the dashboard can show real progress instead of a static three-step card."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from api.auth import get_current_user
from backend.db.base import get_session
from backend.db.models import Paycheck, BudgetCategory, PlaidItem
from backend.services.plaid_service import manual_item_filter

router = APIRouter(prefix="/api/v1/onboarding", tags=["onboarding"])


@router.get("/progress")
async def get_progress(user_id: str = Depends(get_current_user), db: AsyncSession = Depends(get_session)):
    bank_count = (await db.execute(
        select(func.count(PlaidItem.id)).where(PlaidItem.user_id == user_id, ~manual_item_filter())
    )).scalar_one()
    paycheck_count = (await db.execute(
        select(func.count(Paycheck.id)).where(Paycheck.user_id == user_id)
    )).scalar_one()
    category_count = (await db.execute(
        select(func.count(BudgetCategory.id)).where(BudgetCategory.user_id == user_id)
    )).scalar_one()
    due_date_count = (await db.execute(
        select(func.count(BudgetCategory.id)).where(
            BudgetCategory.user_id == user_id, BudgetCategory.due_date_day.isnot(None)
        )
    )).scalar_one()

    steps = [
        {"key": "bank", "label": "Connect a bank account", "href": "/accounts", "done": bank_count > 0},
        {"key": "paycheck", "label": "Add your paychecks", "href": "/paychecks", "done": paycheck_count > 0},
        {"key": "budget", "label": "Set your budget", "href": "/budget", "done": category_count > 0},
        {"key": "due_dates", "label": "Set due dates on your bills", "href": "/budget", "done": due_date_count > 0},
    ]
    done_count = sum(1 for s in steps if s["done"])
    return {"steps": steps, "done_count": done_count, "total_count": len(steps), "complete": done_count == len(steps)}
