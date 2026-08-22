"""Budget spending analytics."""
from __future__ import annotations

import calendar
from datetime import date
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db.models import Transaction, BudgetCategory, BudgetGroup, BudgetMonth


async def monthly_group_trend(user_id: str, months: int, db: AsyncSession) -> list[dict[str, Any]]:
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
            .where(Transaction.user_id == user_id, Transaction.date >= start, Transaction.date <= end, Transaction.pending == False, Transaction.amount > 0)
            .group_by(BudgetGroup.name)
        )
        group_totals = {name: float(total or 0) for name, total in rows}
        results.append({"month_label": start.strftime("%b %Y"), "year": y, "month": m,
                         "groups": group_totals, "total": sum(group_totals.values())})
    return results


async def top_merchants(user_id: str, year: int, month: int, limit: int, db: AsyncSession) -> list[dict[str, Any]]:
    start = date(year, month, 1)
    end = date(year, month, calendar.monthrange(year, month)[1])
    rows = await db.execute(
        select(func.coalesce(Transaction.merchant_name, Transaction.name).label("merchant"),
               func.sum(Transaction.amount).label("total"), func.count(Transaction.id).label("count"))
        .where(Transaction.user_id == user_id, Transaction.date >= start, Transaction.date <= end, Transaction.pending == False, Transaction.amount > 0)
        .group_by(func.coalesce(Transaction.merchant_name, Transaction.name))
        .order_by(func.sum(Transaction.amount).desc()).limit(limit)
    )
    return [{"merchant": m, "total": float(t or 0), "count": c} for m, t, c in rows]


async def year_summary(user_id: str, year: int, db: AsyncSession) -> dict[str, Any]:
    monthly = []
    for m in range(1, 13):
        start = date(year, m, 1)
        end = date(year, m, calendar.monthrange(year, m)[1])
        result = await db.execute(select(func.sum(Transaction.amount)).where(
            Transaction.user_id == user_id, Transaction.date >= start, Transaction.date <= end, Transaction.pending == False, Transaction.amount > 0))
        total = float(result.scalar() or 0)
        bm_result = await db.execute(select(BudgetMonth.total_income).where(BudgetMonth.user_id == user_id, BudgetMonth.year == year, BudgetMonth.month == m))
        income = float(bm_result.scalar() or 0)
        monthly.append({"month": m, "month_label": date(year, m, 1).strftime("%b"), "spent": total, "income": income})
    return {"year": year, "months": monthly, "total_spent": sum(m["spent"] for m in monthly),
            "total_income": sum(m["income"] for m in monthly)}


async def category_trends(user_id: str, months: int, db: AsyncSession) -> list[dict[str, Any]]:
    """Month-over-month spending per category for the last N months, with the
    change of the latest full picture vs the average of the earlier months and
    how many consecutive months each category has risen."""
    today = date.today()
    labels: list[str] = []
    windows: list[tuple[date, date]] = []
    for i in range(months - 1, -1, -1):
        m, y = today.month - i, today.year
        while m <= 0:
            m += 12
            y -= 1
        labels.append(date(y, m, 1).strftime("%b"))
        windows.append((date(y, m, 1), date(y, m, calendar.monthrange(y, m)[1])))

    totals: dict[str, list[float]] = {}
    for idx, (start, end) in enumerate(windows):
        rows = await db.execute(
            select(BudgetGroup.name, BudgetCategory.name, func.sum(Transaction.amount))
            .join(BudgetCategory, Transaction.budget_category_id == BudgetCategory.id)
            .join(BudgetGroup, BudgetCategory.group_id == BudgetGroup.id)
            .where(Transaction.user_id == user_id, Transaction.date >= start, Transaction.date <= end,
                   Transaction.pending == False, Transaction.amount > 0)
            .group_by(BudgetGroup.name, BudgetCategory.name)
        )
        for group, cat, total in rows:
            key = f"{group} › {cat}"
            totals.setdefault(key, [0.0] * len(windows))[idx] = float(total or 0)

    out = []
    for name, series in totals.items():
        current = series[-1]
        prior = series[:-1]
        prior_avg = sum(prior) / len(prior) if prior else 0
        change_pct = ((current - prior_avg) / prior_avg * 100) if prior_avg > 0 else None
        streak = 0
        for i in range(len(series) - 1, 0, -1):
            if series[i] > series[i - 1] > 0:
                streak += 1
            else:
                break
        out.append({
            "category": name,
            "months": labels,
            "totals": [round(v, 2) for v in series],
            "current": round(current, 2),
            "prior_avg": round(prior_avg, 2),
            "change_pct": round(change_pct, 1) if change_pct is not None else None,
            "rising_streak": streak,
        })
    # Biggest current spenders first.
    out.sort(key=lambda x: x["current"], reverse=True)
    return out


async def category_breakdown(user_id: str, year: int, month: int, db: AsyncSession) -> list[dict[str, Any]]:
    start = date(year, month, 1)
    end = date(year, month, calendar.monthrange(year, month)[1])
    rows = await db.execute(
        select(BudgetCategory.name, BudgetGroup.name.label("group_name"), func.sum(Transaction.amount).label("total"))
        .join(BudgetCategory, Transaction.budget_category_id == BudgetCategory.id)
        .join(BudgetGroup, BudgetCategory.group_id == BudgetGroup.id)
        .where(Transaction.user_id == user_id, Transaction.date >= start, Transaction.date <= end, Transaction.pending == False, Transaction.amount > 0)
        .group_by(BudgetCategory.name, BudgetGroup.name)
        .order_by(func.sum(Transaction.amount).desc())
    )
    return [{"category": cat, "group": group, "total": float(total or 0)} for cat, group, total in rows]
