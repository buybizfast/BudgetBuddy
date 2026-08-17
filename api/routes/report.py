"""Monthly report export routes."""
from __future__ import annotations

import calendar
import csv
import io
from datetime import date

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.auth import get_current_user
from backend.db.base import get_session
from backend.db.models import (
    BankAccount, BudgetCategory, BudgetGroup, BudgetMonth,
    DebtAccount, SavingsGoal, Transaction,
)
from backend.services.budget_service import get_budget_month_with_spending

router = APIRouter(prefix="/api/v1/report", tags=["report"])


@router.get("/{year}/{month}")
async def get_monthly_report(year: int, month: int, user_id: str = Depends(get_current_user), db: AsyncSession = Depends(get_session)):
    """Return a comprehensive data bundle for the monthly report."""
    start = date(year, month, 1)
    end = date(year, month, calendar.monthrange(year, month)[1])

    # Budget summary
    budget = await get_budget_month_with_spending(user_id, year, month, db)

    # Transactions
    txns_result = await db.execute(
        select(Transaction, BankAccount.name.label("account_name"))
        .join(BankAccount, Transaction.account_id == BankAccount.id)
        .where(Transaction.user_id == user_id, Transaction.date >= start, Transaction.date <= end, Transaction.pending == False)
        .order_by(Transaction.date.desc())
    )
    transactions = [
        {
            "date": t.date.isoformat(),
            "name": t.name,
            "merchant_name": t.merchant_name,
            "amount": float(t.amount),
            "account_name": acct,
            "category": t.category,
            "budget_category_id": str(t.budget_category_id) if t.budget_category_id else None,
        }
        for t, acct in txns_result.all()
    ]

    # Build category name map
    cat_map: dict[str, str] = {}
    for group in budget.get("groups", []):
        for cat in group.get("categories", []):
            cat_map[cat["id"]] = f'{group["name"]} › {cat["name"]}'
    for t in transactions:
        if t["budget_category_id"]:
            t["budget_category"] = cat_map.get(t["budget_category_id"], "")
        else:
            t["budget_category"] = ""

    # Debts
    debts_result = await db.execute(select(DebtAccount).where(DebtAccount.user_id == user_id).order_by(DebtAccount.sort_order))
    debts = [
        {"name": d.name, "balance": float(d.balance), "interest_rate": float(d.interest_rate), "is_paid_off": d.is_paid_off}
        for d in debts_result.scalars().all()
    ]

    # Savings goals
    goals_result = await db.execute(select(SavingsGoal).where(SavingsGoal.user_id == user_id).order_by(SavingsGoal.sort_order))
    goals = [
        {"name": g.name, "current_amount": float(g.current_amount), "target_amount": float(g.target_amount), "icon": g.icon}
        for g in goals_result.scalars().all()
    ]

    # Accounts
    accounts_result = await db.execute(select(BankAccount).where(BankAccount.user_id == user_id, BankAccount.is_active == True))
    accounts = [
        {"name": a.name, "type": a.type, "current_balance": float(a.current_balance), "institution_name": a.institution_name}
        for a in accounts_result.scalars().all()
        if not a.account_id.startswith("manual-cash")
    ]

    total_income = sum(abs(t["amount"]) for t in transactions if t["amount"] < 0)
    total_spent = sum(t["amount"] for t in transactions if t["amount"] > 0)
    total_debt = sum(d["balance"] for d in debts if not d["is_paid_off"])
    total_saved = sum(g["current_amount"] for g in goals)

    return {
        "year": year, "month": month,
        "budget": budget,
        "transactions": transactions,
        "debts": debts,
        "goals": goals,
        "accounts": accounts,
        "summary": {
            "total_income": round(total_income, 2),
            "total_spent": round(total_spent, 2),
            "net": round(total_income - total_spent, 2),
            "total_debt": round(total_debt, 2),
            "total_saved": round(total_saved, 2),
            "transaction_count": len(transactions),
        },
    }


@router.get("/{year}/{month}/csv")
async def export_csv(year: int, month: int, user_id: str = Depends(get_current_user), db: AsyncSession = Depends(get_session)):
    """Export transactions as CSV."""
    start = date(year, month, 1)
    end = date(year, month, calendar.monthrange(year, month)[1])

    txns_result = await db.execute(
        select(Transaction, BankAccount.name.label("account_name"))
        .join(BankAccount, Transaction.account_id == BankAccount.id)
        .where(Transaction.user_id == user_id, Transaction.date >= start, Transaction.date <= end, Transaction.pending == False)
        .order_by(Transaction.date.desc())
    )
    rows = txns_result.all()

    # Build category name map
    bm_result = await db.execute(
        select(BudgetMonth)
        .where(BudgetMonth.user_id == user_id, BudgetMonth.year == year, BudgetMonth.month == month)
        .options(selectinload(BudgetMonth.groups).selectinload(BudgetGroup.categories))
    )
    bm = bm_result.scalar_one_or_none()
    cat_map: dict[str, str] = {}
    if bm:
        for g in bm.groups:
            for c in g.categories:
                cat_map[str(c.id)] = f"{g.name} > {c.name}"

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Date", "Description", "Merchant", "Amount", "Account", "Budget Category", "Type"])
    for t, acct in rows:
        writer.writerow([
            t.date.isoformat(),
            t.name,
            t.merchant_name or "",
            f"{t.amount:.2f}",
            acct,
            cat_map.get(str(t.budget_category_id), "") if t.budget_category_id else "",
            "Income" if t.amount < 0 else "Expense",
        ])

    output.seek(0)
    month_name = date(year, month, 1).strftime("%B_%Y")
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=BudgetBuddy_{month_name}.csv"},
    )
