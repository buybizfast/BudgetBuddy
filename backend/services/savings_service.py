"""Savings goals CRUD and progress tracking."""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.db.models import SavingsGoal, SavingsContribution


async def list_goals(user_id: str, db: AsyncSession) -> list[dict[str, Any]]:
    result = await db.execute(
        select(SavingsGoal).where(SavingsGoal.user_id == user_id).options(selectinload(SavingsGoal.contributions))
        .order_by(SavingsGoal.sort_order, SavingsGoal.created_at)
    )
    return [_serialize(g) for g in result.scalars().all()]


async def create_goal(user_id: str, name: str, target_amount: float, target_date, icon: str, color: str, db: AsyncSession) -> dict[str, Any]:
    result = await db.execute(select(SavingsGoal).where(SavingsGoal.user_id == user_id).order_by(SavingsGoal.sort_order.desc()).limit(1))
    last = result.scalar_one_or_none()
    goal = SavingsGoal(user_id=user_id, name=name, target_amount=Decimal(str(target_amount)), target_date=target_date,
                       icon=icon, color=color, sort_order=(last.sort_order + 1) if last else 0)
    db.add(goal)
    await db.commit()
    await db.refresh(goal)
    return _serialize(goal)


async def update_goal(goal_id: str, user_id: str, name, target_amount, target_date, db: AsyncSession) -> dict[str, Any]:
    result = await db.execute(select(SavingsGoal).where(SavingsGoal.id == goal_id, SavingsGoal.user_id == user_id))
    goal = result.scalar_one()
    if name is not None: goal.name = name
    if target_amount is not None: goal.target_amount = Decimal(str(target_amount))
    if target_date is not None: goal.target_date = target_date
    await db.commit()
    await db.refresh(goal)
    return _serialize(goal)


async def delete_goal(goal_id: str, user_id: str, db: AsyncSession) -> None:
    result = await db.execute(select(SavingsGoal).where(SavingsGoal.id == goal_id, SavingsGoal.user_id == user_id))
    await db.delete(result.scalar_one())
    await db.commit()


async def add_contribution(goal_id: str, user_id: str, amount: float, contributed_on: date, note, db: AsyncSession) -> dict[str, Any]:
    result = await db.execute(select(SavingsGoal).where(SavingsGoal.id == goal_id, SavingsGoal.user_id == user_id))
    goal = result.scalar_one()
    contrib = SavingsContribution(goal_id=goal_id, amount=Decimal(str(amount)), contributed_on=contributed_on, note=note)
    db.add(contrib)
    new_amount = float(goal.current_amount) + amount
    goal.current_amount = Decimal(str(new_amount))
    if new_amount >= float(goal.target_amount):
        goal.is_completed = True
    await db.commit()
    await db.refresh(contrib)
    return {"id": str(contrib.id), "amount": amount, "contributed_on": contributed_on.isoformat(), "note": note}


def _serialize(goal: SavingsGoal) -> dict[str, Any]:
    target = float(goal.target_amount)
    current = float(goal.current_amount)
    pct = min((current / target) * 100, 100) if target > 0 else 0
    months_left = None
    if goal.target_date:
        today = date.today()
        months_left = max(0, (goal.target_date.year - today.year) * 12 + (goal.target_date.month - today.month))
    return {"id": str(goal.id), "name": goal.name, "target_amount": target, "current_amount": current,
            "target_date": goal.target_date.isoformat() if goal.target_date else None, "icon": goal.icon,
            "color": goal.color, "sort_order": goal.sort_order, "is_completed": goal.is_completed,
            "progress_pct": round(pct, 1), "months_left": months_left,
            "monthly_needed": round((target - current) / months_left, 2) if months_left and months_left > 0 else None,
            "contributions": [{"id": str(c.id), "amount": float(c.amount), "contributed_on": c.contributed_on.isoformat(), "note": c.note} for c in (goal.contributions or [])]}
