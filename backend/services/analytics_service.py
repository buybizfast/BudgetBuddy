"""Budget spending analytics."""
from __future__ import annotations

import calendar
from datetime import date
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db.models import Transaction, BudgetCategory, BudgetGroup, BudgetMonth


async def monthly_group_trend(months: int, db: AsyncSession) -> list[dict[str, Any]]:
    today = date.today()
    results = []
    for i in range(months - 1, -1, -1):
        m = today.month - i
        y = today.year
        while m <= 0:
            m += 12
            y -= 1
        start = date(y, m, 1)
        end = date(y, m, calendar.monthrange(y, m)[1])
        rows = await db.execute(
            select(BudgetGroup.name, func.sum(Transaction.amount))
            .join(BudgetCategory, Transaction.budget_category_id == BudgetCategory.id)
            .join(BudgetGroup, BudgetCategory.group_id == BudgetGroup.id)
            .where(Transaction.date >= start, Transaction.date <= end, Transaction.pending == False, Transaction.amount > 0)
            .group_by(BudgetGroup.name)
        )
        group_totals = {name: float(total or 0) for name, total in rows}
        results.append({"month_label": start.strftime("%b %Y"), "year": y, "month": m,
                         "groups": group_totals, "total": sum(group_totals.values())})
    return results


async def top_merchants(year: int, month: int, limit: int, db: AsyncSession) -> list[dict[str, Any]]:
    start = date(year, month, 1)
    end = date(year, month, calendar.monthrange(year, month)[1])
    rows = await db.execute(
        select(func.coalesce(Transaction.merchant_name, Transaction.name).label("merchant"),
               func.sum(Transaction.amount).label("total"), func.count(Transaction.id).label("count"))
        .where(Transaction.date >= start, Transaction.date <= end, Transaction.pending == False, Transaction.amount > 0)
        .group_by(func.coalesce(Transaction.merchant_name, Transaction.name))
        .order_by(func.sum(Transaction.amount).desc()).limit(limit)
    )
    return [{"merchant": m, "total": float(t or 0), "count": c} for m, t, c in rows]


async def year_summary(year: int, db: AsyncSession) -> dict[str, Any]:
    monthly = []
    for m in range(1, 13):
        start = date(year, m, 1)
        end = date(year, m, calendar.monthrange(year, m)[1])
        result = await db.execute(select(func.sum(Transaction.amount)).where(
            Transaction.date >= start, Transaction.date <= end, Transaction.pending == False, Transaction.amount > 0))
        total = float(result.scalar() or 0)
        bm_result = await db.execute(select(BudgetMonth.total_income).where(BudgetMonth.year == year, BudgetMonth.month == m))
        income = float(bm_result.scalar() or 0)
        monthly.append({"month": m, "month_label": date(year, m, 1).strftime("%b"), "spent": total, "income": income})
    return {"year": year, "months": monthly, "total_spent": sum(m["spent"] for m in monthly),
            "total_income": sum(m["income"] for m in monthly)}


async def category_breakdown(year: int, month: int, db: AsyncSession) -> list[dict[str, Any]]:
    start = date(year, month, 1)
    end = date(year, month, calendar.monthrange(year, month)[1])
    rows = await db.execute(
        select(BudgetCategory.name, BudgetGroup.name.label("group_name"), func.sum(Transaction.amount).label("total"))
        .join(BudgetCategory, Transaction.budget_category_id == BudgetCategory.id)
        .join(BudgetGroup, BudgetCategory.group_id == BudgetGroup.id)
        .where(Transaction.date >= start, Transaction.date <= end, Transaction.pending == False, Transaction.amount > 0)
        .group_by(BudgetCategory.name, BudgetGroup.name)
        .order_by(func.sum(Transaction.amount).desc())
    )
    return [{"category": cat, "group": group, "total": float(total or 0)} for cat, group, total in rows]
