"""Auto-assign transactions to budget categories based on Plaid personal_finance_category."""
from __future__ import annotations

import calendar
from datetime import date
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db.models import BudgetCategory, BudgetGroup, BudgetMonth, Transaction

_CATEGORY_MAP: dict[str, list[str]] = {
    "FOOD_AND_DRINK_RESTAURANTS": ["Restaurants"],
    "FOOD_AND_DRINK_FAST_FOOD": ["Restaurants"],
    "FOOD_AND_DRINK_COFFEE": ["Coffee Shops"],
    "FOOD_AND_DRINK_GROCERIES": ["Groceries"],
    "FOOD_AND_DRINK_ALCOHOL_AND_BAR": ["Restaurants", "Entertainment"],
    "TRANSPORTATION_GAS_STATION": ["Gas"],
    "TRANSPORTATION_PARKING": ["Parking/Tolls"],
    "TRANSPORTATION_PUBLIC_TRANSIT": ["Public Transit"],
    "TRANSPORTATION_TAXI": ["Public Transit"],
    "TRANSPORTATION_CAR_SERVICE": ["Public Transit"],
    "RENT_AND_UTILITIES_RENT": ["Mortgage/Rent"],
    "RENT_AND_UTILITIES_ELECTRICITY": ["Electricity"],
    "RENT_AND_UTILITIES_WATER": ["Water"],
    "RENT_AND_UTILITIES_GAS": ["Natural Gas"],
    "RENT_AND_UTILITIES_INTERNET": ["Internet"],
    "RENT_AND_UTILITIES_TELEPHONE": ["Phone"],
    "RENT_AND_UTILITIES_CABLE": ["Cable/Streaming"],
    "ENTERTAINMENT_STREAMING_SERVICES": ["Cable/Streaming", "Subscriptions"],
    "ENTERTAINMENT_SPORTING_EVENTS": ["Entertainment"],
    "ENTERTAINMENT_CONCERTS_AND_EVENTS": ["Entertainment"],
    "ENTERTAINMENT_MOVIES_AND_DVD": ["Entertainment"],
    "ENTERTAINMENT_VIDEO_GAMES": ["Entertainment"],
    "PERSONAL_CARE_HAIR_AND_BEAUTY": ["Hair/Beauty"],
    "PERSONAL_CARE_GYMS_AND_FITNESS": ["Gym/Fitness"],
    "PERSONAL_CARE_LAUNDRY_AND_DRY_CLEANING": ["Personal"],
    "MEDICAL_DOCTOR_VISITS": ["Medical/Dental"],
    "MEDICAL_DENTIST": ["Medical/Dental"],
    "MEDICAL_PHARMACIES_AND_SUPPLEMENTS": ["Medical/Dental"],
    "MEDICAL_HOSPITALS": ["Medical/Dental"],
    "MEDICAL_MENTAL_HEALTH": ["Medical/Dental"],
    "GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES": ["Clothing"],
    "GENERAL_MERCHANDISE_DISCOUNT_STORES": ["Groceries"],
    "GENERAL_MERCHANDISE_ONLINE_MARKETPLACE": ["Hobbies"],
    "GENERAL_MERCHANDISE_DEPARTMENT_STORES": ["Clothing"],
    "HOME_IMPROVEMENT_HARDWARE": ["Repairs & Maintenance"],
    "HOME_IMPROVEMENT_FURNITURE": ["Hobbies"],
    "LOAN_PAYMENTS_MORTGAGE_PAYMENT": ["Mortgage/Rent"],
    "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT": ["Student Loan"],
    "LOAN_PAYMENTS_CAR_PAYMENT": ["Car Payment"],
    "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT": ["Credit Card 1"],
    "BANK_FEES_ATM_FEES": [],
    "INCOME_WAGES": [],
    "INCOME_TAX_REFUND": [],
    "TRANSFER_IN_ACCOUNT_TRANSFER": [],
    "TRANSFER_OUT_ACCOUNT_TRANSFER": [],
    "GOVERNMENT_AND_NON_PROFIT_DONATIONS": ["Charitable Giving"],
    "GOVERNMENT_AND_NON_PROFIT_RELIGIOUS": ["Tithing"],
    "TRAVEL_FLIGHTS": ["Vacation"],
    "TRAVEL_LODGING": ["Vacation"],
    "TRAVEL_RENTAL_CARS": ["Vacation"],
    "PETS_PET_SUPPLIES": ["Pet Care"],
    "PETS_VETERINARY_SERVICES": ["Pet Care"],
    "EDUCATION_TUITION": ["College Fund"],
    "EDUCATION_BOOKS_AND_SUPPLIES": ["Hobbies"],
    "GENERAL_SERVICES_INSURANCE": ["Life Insurance"],
}


async def auto_assign(txn: Transaction, db: AsyncSession) -> bool:
    if txn.budget_category_id is not None:
        return False
    if float(txn.amount) <= 0:
        return False

    target_names: list[str] = []
    if txn.personal_finance_category:
        pfc = txn.personal_finance_category.upper()
        if pfc in _CATEGORY_MAP:
            target_names = _CATEGORY_MAP[pfc]
        else:
            parts = pfc.split("_")
            for length in range(len(parts) - 1, 0, -1):
                prefix = "_".join(parts[:length])
                for key, names in _CATEGORY_MAP.items():
                    if key.startswith(prefix) and names:
                        target_names = names
                        break
                if target_names:
                    break

    if not target_names and txn.category:
        cat_lower = txn.category.lower()
        for key, names in _CATEGORY_MAP.items():
            if any(part.lower() in cat_lower for part in key.split("_")) and names:
                target_names = names
                break

    if not target_names:
        return False

    if not txn.date:
        return False

    result = await db.execute(
        select(BudgetMonth).where(BudgetMonth.year == txn.date.year, BudgetMonth.month == txn.date.month)
    )
    bm = result.scalar_one_or_none()
    if not bm:
        return False

    for cat_name in target_names:
        result = await db.execute(
            select(BudgetCategory)
            .join(BudgetGroup, BudgetCategory.group_id == BudgetGroup.id)
            .where(BudgetGroup.budget_month_id == bm.id, BudgetCategory.name == cat_name)
        )
        cat = result.scalar_one_or_none()
        if cat:
            txn.budget_category_id = cat.id
            return True

    return False


async def auto_assign_all_unassigned(year: int, month: int, db: AsyncSession) -> int:
    start = date(year, month, 1)
    end = date(year, month, calendar.monthrange(year, month)[1])
    result = await db.execute(
        select(Transaction).where(
            Transaction.date >= start, Transaction.date <= end,
            Transaction.budget_category_id == None, Transaction.amount > 0,
        )
    )
    txns = result.scalars().all()
    count = 0
    for txn in txns:
        if await auto_assign(txn, db):
            count += 1
    await db.commit()
    return count
