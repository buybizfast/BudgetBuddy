"""Budget CRUD: months, groups, categories, and spending summaries."""
from __future__ import annotations

import calendar
from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.db.models import BudgetCategory, BudgetGroup, BudgetMonth, DebtAccount, Transaction

_DEFAULT_GROUPS = [
    ("Income", ["Paycheck", "Other Income"]),
    ("Giving", ["Tithing", "Charitable Giving"]),
    ("Savings", ["Emergency Fund", "Retirement", "College Fund", "Other Savings"]),
    ("Housing", ["Mortgage/Rent", "Electricity", "Water", "Natural Gas", "Internet", "Cable/Streaming", "Phone"]),
    ("Food", ["Groceries", "Restaurants", "Coffee Shops", "Breakfast", "Lunch", "Dinner", "Snacks", "Wraps"]),
    ("Transportation", ["Gas", "Car Payment", "Insurance", "Repairs & Maintenance", "Parking/Tolls", "Public Transit"]),
    ("Personal", ["Clothing", "Hair/Beauty", "Gym/Fitness", "Medical/Dental", "Subscriptions"]),
    ("Lifestyle", ["Entertainment", "Vacation", "Hobbies", "Gifts", "Pet Care", "Alcohol", "Cannabis"]),
    ("Insurance & Tax", ["Life Insurance", "Health Insurance", "Home/Renters Insurance", "Taxes"]),
    ("Debt", ["Credit Card 1", "Student Loan", "Other Debt"]),
]


async def _sync_debt_categories(user_id: str, bm: BudgetMonth, db: AsyncSession) -> bool:
    """Ensure this budget month has a category linked to each active (not
    dismissed, not paid off) debt, so debt payments show up in the budget
    without manual entry. Only creates missing links — an existing linked
    category's budgeted amount is left alone once set, so editing it (e.g.
    to plan an extra payment above the minimum) sticks instead of getting
    silently reset back to the minimum payment on every reload."""
    debt_group = next((g for g in bm.groups if g.name == "Debt"), None)
    if debt_group is None:
        max_sort = max((g.sort_order for g in bm.groups), default=-1)
        debt_group = BudgetGroup(budget_month_id=bm.id, name="Debt", sort_order=max_sort + 1)
        db.add(debt_group)
        await db.flush()

    result = await db.execute(
        select(DebtAccount).where(DebtAccount.user_id == user_id, DebtAccount.dismissed == False, DebtAccount.is_paid_off == False)  # noqa: E712
    )
    active_debts = result.scalars().all()
    linked_debt_ids = {c.debt_account_id for c in debt_group.categories if c.debt_account_id}
    changed = False
    next_sort = max((c.sort_order for c in debt_group.categories), default=-1) + 1
    for debt in active_debts:
        if str(debt.id) in linked_debt_ids:
            continue
        db.add(BudgetCategory(
            user_id=user_id, group_id=debt_group.id, name=debt.name, budgeted=debt.minimum_payment or Decimal("0"),
            sort_order=next_sort, cost_type="fixed", debt_account_id=debt.id,
        ))
        next_sort += 1
        changed = True
    return changed


async def get_or_create_budget_month(user_id: str, year: int, month: int, db: AsyncSession) -> BudgetMonth:
    result = await db.execute(
        select(BudgetMonth).where(BudgetMonth.user_id == user_id, BudgetMonth.year == year, BudgetMonth.month == month)
        .options(selectinload(BudgetMonth.groups).selectinload(BudgetGroup.categories))
    )
    bm = result.scalar_one_or_none()
    if bm:
        changed = False
        # Backfill the Income group for months created before it existed.
        if not any(g.name == "Income" for g in bm.groups):
            income_group = BudgetGroup(budget_month_id=bm.id, name="Income", sort_order=-1)
            db.add(income_group)
            await db.flush()
            for cat_idx, cat_name in enumerate(["Paycheck", "Other Income"]):
                db.add(BudgetCategory(user_id=user_id, group_id=income_group.id, name=cat_name, budgeted=Decimal("0"), sort_order=cat_idx))
            changed = True
        if await _sync_debt_categories(user_id, bm, db):
            changed = True
        if changed:
            await db.commit()
            result = await db.execute(
                select(BudgetMonth).where(BudgetMonth.id == bm.id)
                .options(selectinload(BudgetMonth.groups).selectinload(BudgetGroup.categories))
            )
            bm = result.scalar_one()
        return bm
    bm = BudgetMonth(user_id=user_id, year=year, month=month, total_income=Decimal("0"))
    db.add(bm)
    await db.flush()
    for sort_idx, (group_name, category_names) in enumerate(_DEFAULT_GROUPS):
        group = BudgetGroup(budget_month_id=bm.id, name=group_name, sort_order=sort_idx)
        db.add(group)
        await db.flush()
        for cat_idx, cat_name in enumerate(category_names):
            cat = BudgetCategory(user_id=user_id, group_id=group.id, name=cat_name, budgeted=Decimal("0"), sort_order=cat_idx)
            db.add(cat)
    await db.commit()
    result = await db.execute(
        select(BudgetMonth).where(BudgetMonth.id == bm.id)
        .options(selectinload(BudgetMonth.groups).selectinload(BudgetGroup.categories))
    )
    bm = result.scalar_one()
    if await _sync_debt_categories(user_id, bm, db):
        await db.commit()
        result = await db.execute(
            select(BudgetMonth).where(BudgetMonth.id == bm.id)
            .options(selectinload(BudgetMonth.groups).selectinload(BudgetGroup.categories))
        )
        bm = result.scalar_one()
    return bm


async def get_budget_month_with_spending(user_id: str, year: int, month: int, db: AsyncSession) -> dict[str, Any]:
    bm = await get_or_create_budget_month(user_id, year, month, db)
    result = await db.execute(
        select(BudgetMonth).where(BudgetMonth.id == bm.id)
        .options(selectinload(BudgetMonth.groups).selectinload(BudgetGroup.categories))
    )
    bm = result.scalar_one()
    start_date = date(year, month, 1)
    end_date = date(year, month, calendar.monthrange(year, month)[1])
    spending_result = await db.execute(
        select(Transaction.budget_category_id, func.sum(Transaction.amount))
        .where(Transaction.user_id == user_id, Transaction.date >= start_date, Transaction.date <= end_date,
               Transaction.pending == False, Transaction.budget_category_id.isnot(None))
        .group_by(Transaction.budget_category_id)
    )
    spending_map: dict[str, float] = {}
    for cat_id, total in spending_result:
        if cat_id:
            spending_map[str(cat_id)] = float(total or 0)
    total_budgeted = Decimal("0")
    total_spent = Decimal("0")
    total_fixed_budgeted = Decimal("0")
    total_fixed_spent = Decimal("0")
    total_variable_budgeted = Decimal("0")
    total_variable_spent = Decimal("0")
    groups_data = []
    for group in bm.groups:
        cats_data = []
        group_budgeted = Decimal("0")
        group_spent = Decimal("0")
        for cat in group.categories:
            spent = Decimal(str(spending_map.get(str(cat.id), 0)))
            remaining = cat.budgeted - spent
            cats_data.append({"id": str(cat.id), "name": cat.name, "budgeted": float(cat.budgeted),
                               "spent": float(spent), "remaining": float(remaining), "sort_order": cat.sort_order,
                               "cost_type": cat.cost_type, "is_debt_synced": cat.debt_account_id is not None})
            group_budgeted += cat.budgeted
            group_spent += spent
            # The Income group tracks incoming money, not planned spending —
            # exclude it from the fixed/variable expense breakdown too.
            if group.name != "Income":
                if cat.cost_type == "fixed":
                    total_fixed_budgeted += cat.budgeted
                    total_fixed_spent += spent
                else:
                    total_variable_budgeted += cat.budgeted
                    total_variable_spent += spent
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
            "left_to_budget": total_income - float(total_budgeted), "groups": groups_data,
            "total_fixed_budgeted": float(total_fixed_budgeted), "total_fixed_spent": float(total_fixed_spent),
            "total_variable_budgeted": float(total_variable_budgeted), "total_variable_spent": float(total_variable_spent)}


async def update_budget_income(user_id: str, budget_month_id: str, income: float, db: AsyncSession) -> None:
    result = await db.execute(select(BudgetMonth).where(BudgetMonth.id == budget_month_id, BudgetMonth.user_id == user_id))
    bm = result.scalar_one()
    bm.total_income = Decimal(str(income))
    await db.commit()


async def update_category_budget(user_id: str, category_id: str, budgeted: float, db: AsyncSession) -> None:
    result = await db.execute(select(BudgetCategory).where(BudgetCategory.id == category_id, BudgetCategory.user_id == user_id))
    cat = result.scalar_one()
    cat.budgeted = Decimal(str(budgeted))
    await db.commit()


async def rename_category(user_id: str, category_id: str, name: str, db: AsyncSession) -> None:
    result = await db.execute(select(BudgetCategory).where(BudgetCategory.id == category_id, BudgetCategory.user_id == user_id))
    cat = result.scalar_one()
    cat.name = name.strip()
    await db.commit()


async def update_category_cost_type(user_id: str, category_id: str, cost_type: str, db: AsyncSession) -> None:
    if cost_type not in ("fixed", "variable"):
        raise ValueError("cost_type must be 'fixed' or 'variable'")
    result = await db.execute(select(BudgetCategory).where(BudgetCategory.id == category_id, BudgetCategory.user_id == user_id))
    cat = result.scalar_one()
    cat.cost_type = cost_type
    await db.commit()


async def reorder_groups(user_id: str, budget_month_id: str, group_ids: list[str], db: AsyncSession) -> None:
    result = await db.execute(
        select(BudgetGroup).join(BudgetMonth, BudgetGroup.budget_month_id == BudgetMonth.id)
        .where(BudgetGroup.budget_month_id == budget_month_id, BudgetMonth.user_id == user_id)
    )
    groups_by_id = {str(g.id): g for g in result.scalars().all()}
    for idx, group_id in enumerate(group_ids):
        group = groups_by_id.get(group_id)
        if group is not None:
            group.sort_order = idx
    await db.commit()


async def reorder_categories(user_id: str, group_id: str, category_ids: list[str], db: AsyncSession) -> None:
    result = await db.execute(select(BudgetCategory).where(BudgetCategory.group_id == group_id, BudgetCategory.user_id == user_id))
    cats_by_id = {str(c.id): c for c in result.scalars().all()}
    for idx, cat_id in enumerate(category_ids):
        cat = cats_by_id.get(cat_id)
        if cat is not None:
            cat.sort_order = idx
    await db.commit()


async def delete_budget_category(user_id: str, category_id: str, db: AsyncSession) -> None:
    result = await db.execute(select(BudgetCategory).where(BudgetCategory.id == category_id, BudgetCategory.user_id == user_id))
    cat = result.scalar_one()
    await db.delete(cat)
    await db.commit()


async def add_budget_category(user_id: str, group_id: str, name: str, db: AsyncSession) -> BudgetCategory:
    result = await db.execute(
        select(func.count()).select_from(BudgetCategory).where(BudgetCategory.group_id == group_id, BudgetCategory.user_id == user_id)
    )
    count = result.scalar() or 0
    cat = BudgetCategory(user_id=user_id, group_id=group_id, name=name, budgeted=Decimal("0"), sort_order=count)
    db.add(cat)
    await db.commit()
    await db.refresh(cat)
    return cat


async def assign_transaction_to_category(user_id: str, transaction_id: str, category_id: str | None, db: AsyncSession) -> None:
    result = await db.execute(select(Transaction).where(Transaction.id == transaction_id, Transaction.user_id == user_id))
    txn = result.scalar_one()
    txn.budget_category_id = category_id
    await db.commit()


async def copy_from_previous_month(user_id: str, year: int, month: int, db: AsyncSession) -> dict[str, Any]:
    prev_year, prev_month = (year - 1, 12) if month == 1 else (year, month - 1)
    prev_result = await db.execute(
        select(BudgetMonth).where(BudgetMonth.user_id == user_id, BudgetMonth.year == prev_year, BudgetMonth.month == prev_month)
        .options(selectinload(BudgetMonth.groups).selectinload(BudgetGroup.categories))
    )
    prev = prev_result.scalar_one_or_none()
    if not prev:
        return {"copied": False, "reason": f"No budget found for {prev_year}/{prev_month:02d}"}
    curr = await get_or_create_budget_month(user_id, year, month, db)
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


async def add_missing_default_categories(user_id: str, year: int, month: int, db: AsyncSession) -> dict[str, Any]:
    """Add any categories from _DEFAULT_GROUPS that this month doesn't have yet.

    The defaults only seed a budget month at creation, so months created before
    a category was added to the list never get it. This backfills them without
    touching existing categories or their budgeted amounts. Groups missing
    entirely are created too.
    """
    bm = await get_or_create_budget_month(user_id, year, month, db)
    result = await db.execute(
        select(BudgetMonth).where(BudgetMonth.id == bm.id)
        .options(selectinload(BudgetMonth.groups).selectinload(BudgetGroup.categories))
    )
    bm = result.scalar_one()

    existing_groups = {g.name: g for g in bm.groups}
    added: list[str] = []
    next_group_sort = max((g.sort_order for g in bm.groups), default=-1) + 1

    for group_name, category_names in _DEFAULT_GROUPS:
        group = existing_groups.get(group_name)
        if group is None:
            group = BudgetGroup(budget_month_id=bm.id, name=group_name, sort_order=next_group_sort)
            next_group_sort += 1
            db.add(group)
            await db.flush()
            existing_names: set[str] = set()
            next_cat_sort = 0
        else:
            existing_names = {c.name for c in group.categories}
            next_cat_sort = max((c.sort_order for c in group.categories), default=-1) + 1

        for cat_name in category_names:
            if cat_name in existing_names:
                continue
            db.add(BudgetCategory(
                user_id=user_id, group_id=group.id, name=cat_name,
                budgeted=Decimal("0"), sort_order=next_cat_sort,
            ))
            next_cat_sort += 1
            added.append(f"{group_name} › {cat_name}")

    if added:
        await db.commit()
    return {"added": added, "count": len(added)}
