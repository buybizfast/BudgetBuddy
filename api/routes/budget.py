"""Budget routes."""
from __future__ import annotations

import calendar
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from backend.db.base import get_session
from backend.db.models import BudgetCategory, BudgetGroup, BudgetMonth, Transaction
from backend.services import budget_service, budget_insights

router = APIRouter(prefix="/api/v1/budget", tags=["budget"])


@router.get("/month/{year}/{month}")
async def get_budget_month(year: int, month: int, db: AsyncSession = Depends(get_session)):
    if not (1 <= month <= 12):
        raise HTTPException(status_code=400, detail="Month must be 1-12")
    return await budget_service.get_budget_month_with_spending(year, month, db)


class UpdateIncomeRequest(BaseModel):
    income: float

@router.patch("/month/{budget_month_id}/income")
async def update_income(budget_month_id: str, body: UpdateIncomeRequest, db: AsyncSession = Depends(get_session)):
    await budget_service.update_budget_income(budget_month_id, body.income, db)
    return {"status": "ok"}


class UpdateCategoryRequest(BaseModel):
    budgeted: float

@router.patch("/categories/{category_id}")
async def update_category(category_id: str, body: UpdateCategoryRequest, db: AsyncSession = Depends(get_session)):
    try:
        await budget_service.update_category_budget(category_id, body.budgeted, db)
    except Exception:
        raise HTTPException(status_code=404, detail="Category not found")
    return {"status": "ok"}


class AddCategoryRequest(BaseModel):
    name: str

@router.post("/groups/{group_id}/categories")
async def add_category(group_id: str, body: AddCategoryRequest, db: AsyncSession = Depends(get_session)):
    cat = await budget_service.add_budget_category(group_id, body.name, db)
    return {"id": str(cat.id), "name": cat.name, "budgeted": 0, "sort_order": cat.sort_order}


@router.get("/transactions")
async def list_transactions(year: int = Query(...), month: int = Query(...),
                             account_id: Optional[str] = None, category_id: Optional[str] = None,
                             unassigned: bool = False, limit: int = Query(default=100, le=500),
                             offset: int = 0, db: AsyncSession = Depends(get_session)):
    from backend.db.models import BankAccount
    start_date = date(year, month, 1)
    end_date = date(year, month, calendar.monthrange(year, month)[1])
    q = (select(Transaction, BankAccount.name.label("account_name"))
         .join(BankAccount, Transaction.account_id == BankAccount.id)
         .where(Transaction.date >= start_date, Transaction.date <= end_date)
         .order_by(Transaction.date.desc(), Transaction.created_at.desc()))
    if account_id:
        q = q.where(Transaction.account_id == account_id)
    if category_id:
        q = q.where(Transaction.budget_category_id == category_id)
    if unassigned:
        q = q.where(Transaction.budget_category_id == None, Transaction.amount > 0)
    q = q.limit(limit).offset(offset)
    result = await db.execute(q)
    return [{"id": str(txn.id), "account_name": acct_name, "date": txn.date.isoformat(), "name": txn.name,
             "merchant_name": txn.merchant_name, "amount": float(txn.amount), "category": txn.category,
             "budget_category_id": str(txn.budget_category_id) if txn.budget_category_id else None,
             "pending": txn.pending, "payment_channel": txn.payment_channel, "logo_url": txn.logo_url,
             "personal_finance_category": txn.personal_finance_category} for txn, acct_name in result.all()]


class AssignCategoryRequest(BaseModel):
    budget_category_id: Optional[str] = None

@router.patch("/transactions/{transaction_id}/category")
async def assign_transaction_category(transaction_id: str, body: AssignCategoryRequest, db: AsyncSession = Depends(get_session)):
    await budget_service.assign_transaction_to_category(transaction_id, body.budget_category_id, db)
    return {"status": "ok"}


@router.get("/insights/{year}/{month}")
async def get_insights(year: int, month: int, db: AsyncSession = Depends(get_session)):
    insights = await budget_insights.generate_insights(year, month, db)
    return {"insights": insights, "year": year, "month": month}


_sync_state: dict = {"last_synced_at": None, "last_added": 0, "syncing": False}

@router.get("/sync-status")
async def get_sync_status():
    return _sync_state

@router.post("/sync-now")
async def sync_now(db: AsyncSession = Depends(get_session)):
    from backend.services.plaid_service import refresh_all_items
    from api.ws_manager import ws_manager
    from datetime import datetime, timezone
    _sync_state["syncing"] = True
    try:
        summary = await refresh_all_items(db)
        _sync_state["last_synced_at"] = datetime.now(timezone.utc).isoformat()
        _sync_state["last_added"] = summary["total_added"]
        _sync_state["syncing"] = False
        if summary["total_added"] > 0:
            await ws_manager.broadcast_budget_update(summary["total_added"], summary["new_transactions"])
        return {"synced": summary["total_added"], "new_transactions": summary["new_transactions"]}
    except Exception as exc:
        _sync_state["syncing"] = False
        raise HTTPException(status_code=500, detail=str(exc))

@router.post("/auto-categorize/{year}/{month}")
async def run_auto_categorize(year: int, month: int, db: AsyncSession = Depends(get_session)):
    from backend.services.auto_categorizer import auto_assign_all_unassigned
    count = await auto_assign_all_unassigned(year, month, db)
    return {"assigned": count}

@router.post("/month/{year}/{month}/copy-previous")
async def copy_previous_month(year: int, month: int, db: AsyncSession = Depends(get_session)):
    if not (1 <= month <= 12):
        raise HTTPException(status_code=400, detail="Month must be 1-12")
    return await budget_service.copy_from_previous_month(year, month, db)

@router.get("/recurring")
async def detect_recurring_transactions(months_back: int = Query(default=6, ge=1, le=24), db: AsyncSession = Depends(get_session)):
    from backend.services.recurring_service import detect_recurring
    return await detect_recurring(db, months_back)
