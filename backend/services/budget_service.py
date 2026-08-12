"""Budget CRUD: months, groups, categories, and spending summaries."""
from __future__ import annotations

import calendar
from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.db.models import BudgetCategory, BudgetGroup, BudgetMonth, Transaction

_DEFAULT_GROUPS = [
    ("Income", ["Paycheck", "Other Income"]),
    ("Giving", ["Tithing", "Charitable Giving"]),
    ("Savings", ["Emergency Fund", "Retirement", "College Fund", "Other Savings"]),
    ("Housing", ["Mortgage/Rent", "Electricity", "Water", "Natural Gas", "Internet", "Cable/Streaming", "Phone"]),
    ("Food", ["Groceries", "Restaurants", "Coffee Shops"]),
    ("Transportation", ["Gas", "Car Payment", "Insurance", "Repairs & Maintenance", "Parking/Tolls", "Public Transit"]),
    ("Personal", ["Clothing", "Hair/Beauty", "Gym/Fitness", "Medical/Dental", "Subscriptions"]),
    ("Lifestyle", ["Entertainment", "Vacation", "Hobbies", "Gifts", "Pet Care"]),
    ("Insurance & Tax", ["Life Insurance", "Health Insurance", "Home/Renters Insurance", "Taxes"]),
    ("Debt", ["Credit Card 1", "Student Loan", "Other Debt"]),
]


async def get_or_create_budget_month(year: int, month: int, db: AsyncSession) -> BudgetMonth:
    result = await db.execute(
        select(BudgetMonth).where(BudgetMonth.year == year, BudgetMonth.month == month)
        .options(selectinload(BudgetMonth.groups).selectinload(BudgetGroup.categories))
    )
    bm = result.scalar_one_or_none()
    if bm:
        return bm
    bm = BudgetMonth(year=year, month=month, total_income=Decimal("0"))
    db.add(bm)
    await db.flush()
    for sort_idx, (group_name, category_names) in enumerate(_DEFAULT_GROUPS):
        group = BudgetGroup(budget_month_id=bm.id, name=group_name, sort_order=sort_idx)
        db.add(group)
        await db.flush()
        for cat_idx, cat_name in enumerate(category_names):
            cat = BudgetCategory(group_id=group.id, name=cat_name, budgeted=Decimal("0"), sort_order=cat_idx)
            db.add(cat)
    await db.commit()
    await db.refresh(bm)
    return bm


async def get_budget_month_with_spending(year: int, month: int, db: AsyncSession) -> dict[str, Any]:
    bm = await get_or_create_budget_month(year, month, db)
    result = await db.execute(
        select(BudgetMonth).where(BudgetMonth.id == bm.id)
        .options(selectinload(BudgetMonth.groups).selectinload(BudgetGroup.categories))
    )
    bm = result.scalar_one()
    start_date = date(year, month, 1)
    end_date = date(year, month, calendar.monthrange(year, month)[1])
    spending_result = await db.execute(
        select(Transaction.budget_category_id, func.sum(Transaction.amount))
        .where(Transaction.date >= start_date, Transaction.date <= end_date,
               Transaction.pending == False, Transaction.budget_category_id.isnot(None))
        .group_by(Transaction.budget_category_id)
    )
    spending_map: dict[str, float] = {}
    for cat_id, total in spending_result:
        if cat_id:
            spending_map[str(cat_id)] = float(total or 0)
    total_budgeted = Decimal("0")
    total_spent = Decimal("0")
    groups_data = []
    for group in bm.groups:
        cats_data = []
        group_budgeted = Decimal("0")
        group_spent = Decimal("0")
        for cat in group.categories:
            spent = Decimal(str(spending_map.get(str(cat.id), 0)))
            remaining = cat.budgeted - spent
            cats_data.append({"id": str(cat.id), "name": cat.name, "budgeted": float(cat.budgeted),
                               "spent": float(spent), "remaining": float(remaining), "sort_order": cat.sort_order})
            group_budgeted += cat.budgeted
            group_spent += spent
        groups_data.append({"id": str(group.id), "name": group.name, "budgeted": float(group_budgeted),
                             "spent": float(group_spent), "remaining": float(group_budgeted - group_spent),
                             "sort_order": group.sort_order, "categories": cats_data})
        # The Income group tracks incoming money (paychecks, deposits), not
        # planned spending — exclude it from the expense-side totals so it
        # doesn't distort "Left to Budget".
        if group.name != "Income":
            total_budgeted += group_budgeted
            total_spent += group_spent
    total_income = float(bm.total_income or 0)
    return {"id": str(bm.id), "year": bm.year, "month": bm.month, "total_income": total_income,
            "total_budgeted": float(total_budgeted), "total_spent": float(total_spent),
            "left_to_budget": total_income - float(total_budgeted), "groups": groups_data}


async def update_budget_income(budget_month_id: str, income: float, db: AsyncSession) -> None:
    result = await db.execute(select(BudgetMonth).where(BudgetMonth.id == budget_month_id))
    bm = result.scalar_one()
    bm.total_income = Decimal(str(income))
    await db.commit()


async def update_category_budget(category_id: str, budgeted: float, db: AsyncSession) -> None:
    result = await db.execute(select(BudgetCategory).where(BudgetCategory.id == category_id))
    cat = result.scalar_one()
    cat.budgeted = Decimal(str(budgeted))
    await db.commit()


async def add_budget_category(group_id: str, name: str, db: AsyncSession) -> BudgetCategory:
    result = await db.execute(select(func.count()).select_from(BudgetCategory).where(BudgetCategory.group_id == group_id))
    count = result.scalar() or 0
    cat = BudgetCategory(group_id=group_id, name=name, budgeted=Decimal("0"), sort_order=count)
    db.add(cat)
    await db.commit()
    await db.refresh(cat)
    return cat


async def assign_transaction_to_category(transaction_id: str, category_id: str | None, db: AsyncSession) -> None:
    result = await db.execute(select(Transaction).where(Transaction.id == transaction_id))
    txn = result.scalar_one()
    txn.budget_category_id = category_id
    await db.commit()


async def copy_from_previous_month(year: int, month: int, db: AsyncSession) -> dict[str, Any]:
    prev_year, prev_month = (year - 1, 12) if month == 1 else (year, month - 1)
    prev_result = await db.execute(
        select(BudgetMonth).where(BudgetMonth.year == prev_year, BudgetMonth.month == prev_month)
        .options(selectinload(BudgetMonth.groups).selectinload(BudgetGroup.categories))
    )
    prev = prev_result.scalar_one_or_none()
    if not prev:
        return {"copied": False, "reason": f"No budget found for {prev_year}/{prev_month:02d}"}
    curr = await get_or_create_budget_month(year, month, db)
    curr_result = await db.execute(
        select(BudgetMonth).where(BudgetMonth.id == curr.id)
        .options(selectinload(BudgetMonth.groups).selectinload(BudgetGroup.categories))
    )
    curr = curr_result.scalar_one()
    curr.total_income = prev.total_income
    prev_amounts: dict[tuple, Decimal] = {}
    for grp in prev.groups:
        for cat in grp.categories:
            prev_amounts[(grp.name, cat.name)] = cat.budgeted
    cats_updated = 0
    for grp in curr.groups:
        for cat in grp.categories:
            key = (grp.name, cat.name)
            if key in prev_amounts:
                cat.budgeted = prev_amounts[key]
                cats_updated += 1
    await db.commit()
    return {"copied": True, "categories_updated": cats_updated, "income_copied": float(prev.total_income)}
