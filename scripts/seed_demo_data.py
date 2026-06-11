"""Seed the database with realistic demo data for local development.

Run with: .venv/bin/python -m scripts.seed_demo_data
"""
from __future__ import annotations

import asyncio
from datetime import date
from decimal import Decimal

from backend.db.base import session_scope, engine
from backend.db.models import (
    Base, BankAccount, BudgetCategory, BudgetGroup, BudgetMonth, DebtAccount,
    PlaidItem, SavingsGoal, SpendingAlert, Transaction,
)
from backend.services.budget_service import get_or_create_budget_month
from backend.services.auto_categorizer import auto_assign_all_unassigned

TODAY = date(2026, 6, 11)


def m(year: int, month: int, day: int) -> date:
    return date(year, month, day)


async def seed() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with session_scope() as db:
        item = PlaidItem(
            item_id="demo-item-1",
            access_token="demo-access-token",
            institution_id="ins_demo",
            institution_name="Demo Credit Union",
            status="active",
        )
        db.add(item)
        await db.flush()

        checking = BankAccount(
            plaid_item_id=item.id, account_id="demo-checking", name="Everyday Checking",
            official_name="Demo Everyday Checking", type="depository", subtype="checking",
            current_balance=Decimal("4218.53"), available_balance=Decimal("4218.53"),
            mask="1234", institution_name="Demo Credit Union",
        )
        savings = BankAccount(
            plaid_item_id=item.id, account_id="demo-savings", name="High-Yield Savings",
            official_name="Demo High-Yield Savings", type="depository", subtype="savings",
            current_balance=Decimal("12450.00"), available_balance=Decimal("12450.00"),
            mask="5678", institution_name="Demo Credit Union",
        )
        credit_card = BankAccount(
            plaid_item_id=item.id, account_id="demo-credit-card", name="Rewards Credit Card",
            official_name="Demo Rewards Visa", type="credit", subtype="credit card",
            current_balance=Decimal("1840.22"), available_balance=Decimal("3159.78"),
            mask="9012", institution_name="Demo Credit Union",
        )
        db.add_all([checking, savings, credit_card])
        await db.flush()

        # --- Budget months: April, May, June 2026 ---
        for year, month in [(2026, 4), (2026, 5), (2026, 6)]:
            await get_or_create_budget_month(year, month, db)

        # Set income + budgeted amounts for June 2026
        june = await get_or_create_budget_month(2026, 6, db)
        june.total_income = Decimal("5200.00")
        await db.flush()

        budgeted_amounts = {
            "Tithing": 250, "Charitable Giving": 50,
            "Emergency Fund": 300, "Retirement": 200, "Other Savings": 100,
            "Mortgage/Rent": 1500, "Electricity": 100, "Water": 45, "Natural Gas": 35,
            "Internet": 60, "Cable/Streaming": 30, "Phone": 65,
            "Groceries": 500, "Restaurants": 200, "Coffee Shops": 40,
            "Gas": 150, "Car Payment": 320, "Insurance": 110,
            "Repairs & Maintenance": 50, "Parking/Tolls": 20, "Public Transit": 0,
            "Clothing": 60, "Hair/Beauty": 40, "Gym/Fitness": 45, "Medical/Dental": 50,
            "Subscriptions": 30,
            "Entertainment": 100, "Vacation": 150, "Hobbies": 50, "Gifts": 30, "Pet Care": 40,
            "Life Insurance": 25, "Health Insurance": 180, "Home/Renters Insurance": 35, "Taxes": 0,
            "Credit Card 1": 100, "Student Loan": 220, "Other Debt": 0,
        }
        for grp in june.groups:
            for cat in grp.categories:
                if cat.name in budgeted_amounts:
                    cat.budgeted = Decimal(str(budgeted_amounts[cat.name]))
        await db.commit()

        # --- Transactions across April, May, June ---
        txns: list[Transaction] = []

        def add(account, amount, dt, name, merchant=None, pfc=None, pending=False):
            txns.append(Transaction(
                account_id=account.id, amount=Decimal(str(amount)), date=dt, name=name,
                merchant_name=merchant or name, personal_finance_category=pfc, pending=pending,
            ))

        for year, month, paydays, rent_day in [(2026, 4, [3, 17], 1), (2026, 5, [1, 15, 29], 1), (2026, 6, [5], 1)]:
            # Income (paychecks) - negative amount = inflow
            for d in paydays:
                add(checking, -2600.00, m(year, month, d), "Acme Corp Payroll", "Acme Corp", "INCOME_WAGES")

            # Rent
            add(checking, 1500.00, m(year, month, rent_day), "Maple Apartments Rent", "Maple Apartments", "RENT_AND_UTILITIES_RENT")

            # Utilities
            add(checking, 92.40, m(year, month, 4), "City Electric Co", "City Electric", "RENT_AND_UTILITIES_ELECTRICITY")
            add(checking, 41.10, m(year, month, 4), "City Water Utility", "City Water", "RENT_AND_UTILITIES_WATER")
            add(checking, 32.00, m(year, month, 6), "Metro Natural Gas", "Metro Gas", "RENT_AND_UTILITIES_GAS")
            add(checking, 59.99, m(year, month, 7), "Comcast Internet", "Comcast", "RENT_AND_UTILITIES_INTERNET")
            add(checking, 65.00, m(year, month, 8), "Verizon Wireless", "Verizon", "RENT_AND_UTILITIES_TELEPHONE")

            # Subscriptions (recurring, monthly)
            add(credit_card, 15.99, m(year, month, 5), "Netflix.com", "Netflix", "ENTERTAINMENT_STREAMING_SERVICES")
            add(credit_card, 11.99, m(year, month, 5), "Spotify USA", "Spotify", "ENTERTAINMENT_STREAMING_SERVICES")
            add(credit_card, 39.99, m(year, month, 2), "Anytime Fitness", "Anytime Fitness", "PERSONAL_CARE_GYMS_AND_FITNESS")

            # Car payment & insurance
            add(checking, 320.00, m(year, month, 10), "AutoFinance Loan Pmt", "AutoFinance", "LOAN_PAYMENTS_CAR_PAYMENT")
            add(checking, 110.00, m(year, month, 12), "Geico Insurance", "Geico", "GENERAL_SERVICES_INSURANCE")

            # Groceries
            add(credit_card, 84.32, m(year, month, 2), "Trader Joe's", "Trader Joe's", "FOOD_AND_DRINK_GROCERIES")
            add(credit_card, 112.78, m(year, month, 9), "Whole Foods Market", "Whole Foods", "FOOD_AND_DRINK_GROCERIES")
            add(credit_card, 96.45, m(year, month, 16), "Trader Joe's", "Trader Joe's", "FOOD_AND_DRINK_GROCERIES")
            add(credit_card, 103.21, m(year, month, 23), "Whole Foods Market", "Whole Foods", "FOOD_AND_DRINK_GROCERIES")

            # Restaurants / coffee
            add(credit_card, 42.18, m(year, month, 6), "Chipotle", "Chipotle", "FOOD_AND_DRINK_RESTAURANTS")
            add(credit_card, 67.50, m(year, month, 13), "Local Bistro", "Local Bistro", "FOOD_AND_DRINK_RESTAURANTS")
            add(credit_card, 38.90, m(year, month, 20), "Sushi House", "Sushi House", "FOOD_AND_DRINK_RESTAURANTS")
            for d in (3, 10, 17, 24):
                add(credit_card, 5.75, m(year, month, d), "Blue Bottle Coffee", "Blue Bottle Coffee", "FOOD_AND_DRINK_COFFEE")

            # Gas
            add(credit_card, 48.20, m(year, month, 5), "Shell Gas Station", "Shell", "TRANSPORTATION_GAS_STATION")
            add(credit_card, 51.10, m(year, month, 19), "Chevron Gas Station", "Chevron", "TRANSPORTATION_GAS_STATION")

            # Misc lifestyle
            add(credit_card, 35.00, m(year, month, 14), "AMC Theatres", "AMC Theatres", "ENTERTAINMENT_MOVIES_AND_DVD")
            add(credit_card, 28.40, m(year, month, 21), "PetSmart", "PetSmart", "PETS_PET_SUPPLIES")

        # June pending transaction (not yet posted)
        add(credit_card, 22.15, m(2026, 6, 11), "Uber Eats", "Uber Eats", "FOOD_AND_DRINK_RESTAURANTS", pending=True)

        db.add_all(txns)
        await db.commit()

        # Auto-categorize all transactions
        for year, month in [(2026, 4), (2026, 5), (2026, 6)]:
            await auto_assign_all_unassigned(year, month, db)

        # --- Debts ---
        cc_debt = DebtAccount(
            name="Rewards Credit Card", balance=Decimal("1840.22"), minimum_payment=Decimal("75.00"),
            interest_rate=Decimal("22.99"), sort_order=0,
        )
        student_loan = DebtAccount(
            name="Federal Student Loan", balance=Decimal("18250.00"), minimum_payment=Decimal("220.00"),
            interest_rate=Decimal("5.50"), sort_order=1,
        )
        db.add_all([cc_debt, student_loan])

        # --- Savings goals ---
        emergency_goal = SavingsGoal(
            name="Emergency Fund", target_amount=Decimal("10000.00"), current_amount=Decimal("4000.00"),
            target_date=date(2026, 12, 31), icon="🛟", color="blue", sort_order=0,
        )
        vacation_goal = SavingsGoal(
            name="Hawaii Vacation", target_amount=Decimal("3000.00"), current_amount=Decimal("800.00"),
            target_date=date(2027, 6, 1), icon="🏝️", color="sky", sort_order=1,
        )
        db.add_all([emergency_goal, vacation_goal])
        await db.commit()

        # --- Spending alert on Restaurants ---
        result = await db.execute(
            select_category("Restaurants")
        )
        cat = result.scalar_one_or_none()
        if cat:
            db.add(SpendingAlert(category_id=cat.id, threshold_pct=80, enabled=True))
            await db.commit()

    print("Seed complete.")


def select_category(name: str):
    from sqlalchemy import select
    return (
        select(BudgetCategory)
        .join(BudgetGroup, BudgetCategory.group_id == BudgetGroup.id)
        .join(BudgetMonth, BudgetGroup.budget_month_id == BudgetMonth.id)
        .where(BudgetMonth.year == 2026, BudgetMonth.month == 6, BudgetCategory.name == name)
    )


if __name__ == "__main__":
    asyncio.run(seed())
