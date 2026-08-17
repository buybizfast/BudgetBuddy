"""Debt snowball routes."""
from __future__ import annotations

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from api.auth import get_current_user
from backend.db.base import get_session
from backend.services import debt_service

router = APIRouter(prefix="/api/v1/debt", tags=["debt"])

@router.get("/plan")
async def payoff_plan(extra_monthly: float = 0.0, strategy: str = "snowball", user_id: str = Depends(get_current_user), db: AsyncSession = Depends(get_session)):
    if strategy not in ("snowball", "avalanche"):
        raise HTTPException(status_code=400, detail="strategy must be 'snowball' or 'avalanche'")
    return await debt_service.compute_payoff_plan(user_id, extra_monthly, strategy, db)

@router.get("/plan/compare")
async def payoff_plan_compare(extra_monthly: float = 0.0, user_id: str = Depends(get_current_user), db: AsyncSession = Depends(get_session)):
    """Both snowball and avalanche plans (with month-by-month balance
    trajectories) for the graph/schedule comparison view."""
    return await debt_service.compute_payoff_comparison(user_id, extra_monthly, db)

@router.get("/")
async def list_debts(user_id: str = Depends(get_current_user), db: AsyncSession = Depends(get_session)):
    return await debt_service.list_debts(user_id, db)

class CreateDebtRequest(BaseModel):
    name: str; balance: float; minimum_payment: float = 0.0; interest_rate: float = 0.0
    account_type: str = "loan"; due_date_day: Optional[int] = None; statement_date_day: Optional[int] = None
    total_installments: Optional[int] = None; original_balance: Optional[float] = None
    credit_limit: Optional[float] = None

@router.post("/")
async def create_debt(body: CreateDebtRequest, user_id: str = Depends(get_current_user), db: AsyncSession = Depends(get_session)):
    return await debt_service.create_debt(
        user_id, body.name, body.balance, body.minimum_payment, body.interest_rate, db,
        account_type=body.account_type, due_date_day=body.due_date_day, statement_date_day=body.statement_date_day,
        total_installments=body.total_installments, original_balance=body.original_balance,
        credit_limit=body.credit_limit,
    )

class UpdateDebtRequest(BaseModel):
    name: Optional[str] = None; balance: Optional[float] = None
    minimum_payment: Optional[float] = None; interest_rate: Optional[float] = None
    account_type: Optional[str] = None; due_date_day: Optional[int] = None; statement_date_day: Optional[int] = None
    total_installments: Optional[int] = None; installments_paid: Optional[int] = None
    original_balance: Optional[float] = None; credit_limit: Optional[float] = None

@router.patch("/{debt_id}")
async def update_debt(debt_id: str, body: UpdateDebtRequest, user_id: str = Depends(get_current_user), db: AsyncSession = Depends(get_session)):
    try:
        return await debt_service.update_debt(
            debt_id, user_id, body.name, body.balance, body.minimum_payment, body.interest_rate, db,
            account_type=body.account_type, due_date_day=body.due_date_day, statement_date_day=body.statement_date_day,
            total_installments=body.total_installments, installments_paid=body.installments_paid,
            original_balance=body.original_balance, credit_limit=body.credit_limit,
        )
    except Exception:
        raise HTTPException(status_code=404, detail="Debt not found")

@router.delete("/{debt_id}")
async def delete_debt(debt_id: str, user_id: str = Depends(get_current_user), db: AsyncSession = Depends(get_session)):
    try:
        await debt_service.delete_debt(debt_id, user_id, db)
        return {"status": "ok"}
    except Exception:
        raise HTTPException(status_code=404, detail="Debt not found")

class AddPaymentRequest(BaseModel):
    amount: float; paid_on: date; note: Optional[str] = None

@router.post("/{debt_id}/payments")
async def add_payment(debt_id: str, body: AddPaymentRequest, user_id: str = Depends(get_current_user), db: AsyncSession = Depends(get_session)):
    try:
        return await debt_service.add_payment(debt_id, user_id, body.amount, body.paid_on, body.note, db)
    except Exception:
        raise HTTPException(status_code=404, detail="Debt not found")
