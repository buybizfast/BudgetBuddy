"""Savings goals routes."""
from __future__ import annotations

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from api.auth import get_current_user
from backend.db.base import get_session
from backend.services import savings_service

router = APIRouter(prefix="/api/v1/goals", tags=["goals"])

@router.get("/")
async def list_goals(user_id: str = Depends(get_current_user), db: AsyncSession = Depends(get_session)):
    return await savings_service.list_goals(user_id, db)

class CreateGoalRequest(BaseModel):
    name: str; target_amount: float; target_date: Optional[date] = None
    icon: str = "🎯"; color: str = "emerald"

@router.post("/")
async def create_goal(body: CreateGoalRequest, user_id: str = Depends(get_current_user), db: AsyncSession = Depends(get_session)):
    return await savings_service.create_goal(user_id, body.name, body.target_amount, body.target_date, body.icon, body.color, db)

class UpdateGoalRequest(BaseModel):
    name: Optional[str] = None; target_amount: Optional[float] = None; target_date: Optional[date] = None

@router.patch("/{goal_id}")
async def update_goal(goal_id: str, body: UpdateGoalRequest, user_id: str = Depends(get_current_user), db: AsyncSession = Depends(get_session)):
    try:
        return await savings_service.update_goal(goal_id, user_id, body.name, body.target_amount, body.target_date, db)
    except Exception:
        raise HTTPException(status_code=404, detail="Goal not found")

@router.delete("/{goal_id}")
async def delete_goal(goal_id: str, user_id: str = Depends(get_current_user), db: AsyncSession = Depends(get_session)):
    try:
        await savings_service.delete_goal(goal_id, user_id, db)
        return {"status": "ok"}
    except Exception:
        raise HTTPException(status_code=404, detail="Goal not found")

class AddContributionRequest(BaseModel):
    amount: float; contributed_on: date; note: Optional[str] = None

@router.post("/{goal_id}/contributions")
async def add_contribution(goal_id: str, body: AddContributionRequest, user_id: str = Depends(get_current_user), db: AsyncSession = Depends(get_session)):
    try:
        return await savings_service.add_contribution(goal_id, user_id, body.amount, body.contributed_on, body.note, db)
    except Exception:
        raise HTTPException(status_code=404, detail="Goal not found")
