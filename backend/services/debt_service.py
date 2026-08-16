"""Debt snowball / avalanche tracker service."""
from __future__ import annotations

import logging
import math
from datetime import date
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.db.models import BankAccount, BudgetCategory, BudgetGroup, BudgetMonth, DebtAccount, DebtPayment

log = logging.getLogger("services.debt")


def _estimate_payoff(balance: float, annual_rate_pct: float, minimum_payment: float) -> dict[str, Any]:
    """Months to pay off at minimum payment only, plus a projected payoff date."""
    if balance <= 0:
        return {"months": 0, "date": date.today().isoformat()}
    if minimum_payment <= 0:
        # No minimum payment on record (e.g. Plaid-synced debts, whose
        # balance/accounts endpoint doesn't provide one) — there's nothing to
        # project a payoff from, distinct from "balance is already zero".
        return {"months": None, "date": None}
    monthly_rate = annual_rate_pct / 100 / 12
    if monthly_rate <= 0:
        months = math.ceil(balance / minimum_payment)
    elif minimum_payment <= balance * monthly_rate:
        # Minimum payment never covers interest — balance never shrinks.
        return {"months": None, "date": None}
    else:
        months = math.ceil(
            -math.log(1 - (monthly_rate * balance) / minimum_payment) / math.log(1 + monthly_rate)
        )
    payoff_year = date.today().year + (date.today().month - 1 + months) // 12
    payoff_month = (date.today().month - 1 + months) % 12 + 1
    return {"months": months, "date": date(payoff_year, payoff_month, 1).isoformat()}


async def list_debts(db: AsyncSession) -> list[dict[str, Any]]:
    result = await db.execute(
        select(DebtAccount).where(DebtAccount.dismissed == False)  # noqa: E712
        .options(selectinload(DebtAccount.payments))
        .order_by(DebtAccount.balance, DebtAccount.created_at)
    )
    debts = result.scalars().all()

    # Credit limit lives on the linked BankAccount (from Plaid), not on
    # DebtAccount itself — pull it in for utilization display on credit
    # card debts that are synced.
    bank_account_ids = [d.bank_account_id for d in debts if d.bank_account_id]
    credit_limits: dict[str, float] = {}
    if bank_account_ids:
        result = await db.execute(
            select(BankAccount.id, BankAccount.credit_limit).where(BankAccount.id.in_(bank_account_ids))
        )
        credit_limits = {str(bid): float(limit) for bid, limit in result.all() if limit is not None}

    def _effective_limit(d: DebtAccount) -> Optional[float]:
        synced = credit_limits.get(str(d.bank_account_id)) if d.bank_account_id else None
        if synced is not None:
            return synced
        return float(d.credit_limit) if d.credit_limit is not None else None

    return [_serialize(d, _effective_limit(d)) for d in debts]


# Maps Plaid's account subtype (within type "credit"/"loan") to this app's
# account_type buckets. Falls back to "credit_card" for type "credit" and
# "loan" for type "loan" when the subtype isn't recognized.
_PLAID_SUBTYPE_TO_DEBT_TYPE = {
    "credit card": "credit_card",
    "paypal": "credit_card",
    "student": "student_loan",
    "auto": "auto_loan",
    "consumer": "personal_loan",
    "mortgage": "loan",
    "home equity": "loan",
    "line of credit": "loan",
    "overdraft": "loan",
    "business": "loan",
    "commercial": "loan",
    "construction": "loan",
    "loan": "loan",
}


async def sync_debt_from_plaid_account(
    bank_account_id: str, name: str, balance: float, plaid_type: str,
    plaid_subtype: Optional[str], db: AsyncSession,
) -> None:
    """Auto-create (or keep in sync) a DebtAccount for a linked Plaid credit-card
    or loan account. No-op for depository/investment accounts. Does not commit —
    the caller's transaction handles that."""
    if plaid_type not in ("credit", "loan"):
        return
    result = await db.execute(select(DebtAccount).where(DebtAccount.bank_account_id == bank_account_id))
    debt = result.scalar_one_or_none()
    clamped_balance = max(balance, 0)
    if debt is None:
        default_type = "credit_card" if plaid_type == "credit" else "loan"
        account_type = _PLAID_SUBTYPE_TO_DEBT_TYPE.get(plaid_subtype or "", default_type)
        result = await db.execute(select(DebtAccount).order_by(DebtAccount.sort_order.desc()).limit(1))
        last = result.scalar_one_or_none()
        sort_order = (last.sort_order + 1) if last else 0
        db.add(DebtAccount(
            name=name, balance=Decimal(str(clamped_balance)), account_type=account_type,
            bank_account_id=bank_account_id, sort_order=sort_order, is_paid_off=clamped_balance <= 0,
        ))
        log.info("Auto-created debt account %r (type=%s, balance=%s) from bank_account_id=%s",
                 name, account_type, clamped_balance, bank_account_id)
    elif not debt.dismissed:
        # Keep the balance current, but leave user-entered fields (minimum
        # payment, interest rate, due dates, name) alone — those aren't
        # available from Plaid's accounts endpoint.
        debt.balance = Decimal(str(clamped_balance))
        debt.is_paid_off = clamped_balance <= 0
        log.info("Updated synced debt account %r balance to %s", name, clamped_balance)
    else:
        log.info("Debt account %r is dismissed — leaving hidden, not updating balance", name)


async def apply_liability_snapshot(
    bank_account_id: str, db: AsyncSession, minimum_payment: Optional[float] = None,
    interest_rate: Optional[float] = None, due_date_day: Optional[int] = None,
    statement_date_day: Optional[int] = None,
) -> None:
    """Fill in the fields Plaid's /accounts/get can't provide (minimum payment,
    interest rate, due/statement dates) from a /liabilities/get snapshot, for a
    debt already auto-created by sync_debt_from_plaid_account. Only touches
    fields we actually got a value for. Does not commit."""
    result = await db.execute(select(DebtAccount).where(DebtAccount.bank_account_id == bank_account_id))
    debt = result.scalar_one_or_none()
    if debt is None or debt.dismissed:
        return
    if minimum_payment is not None:
        debt.minimum_payment = Decimal(str(minimum_payment))
    if interest_rate is not None:
        debt.interest_rate = Decimal(str(interest_rate))
    if due_date_day is not None:
        debt.due_date_day = due_date_day
    if statement_date_day is not None:
        debt.statement_date_day = statement_date_day


async def create_debt(
    name: str, balance: float, minimum_payment: float, interest_rate: float, db: AsyncSession,
    account_type: str = "loan", due_date_day: Optional[int] = None, statement_date_day: Optional[int] = None,
    total_installments: Optional[int] = None, original_balance: Optional[float] = None,
    credit_limit: Optional[float] = None,
) -> dict[str, Any]:
    result = await db.execute(select(DebtAccount).order_by(DebtAccount.sort_order.desc()).limit(1))
    last = result.scalar_one_or_none()
    sort_order = (last.sort_order + 1) if last else 0
    debt = DebtAccount(name=name, balance=Decimal(str(balance)), minimum_payment=Decimal(str(minimum_payment)),
                       interest_rate=Decimal(str(interest_rate)), sort_order=sort_order,
                       account_type=account_type, due_date_day=due_date_day, statement_date_day=statement_date_day,
                       total_installments=total_installments,
                       original_balance=Decimal(str(original_balance)) if original_balance is not None else None,
                       credit_limit=Decimal(str(credit_limit)) if credit_limit is not None else None)
    db.add(debt)
    await db.commit()
    await db.refresh(debt)
    return _serialize(debt)


async def update_debt(
    debt_id: str, name, balance, minimum_payment, interest_rate, db: AsyncSession,
    account_type=None, due_date_day=None, statement_date_day=None,
    total_installments=None, installments_paid=None, original_balance=None, credit_limit=None,
) -> dict[str, Any]:
    result = await db.execute(select(DebtAccount).where(DebtAccount.id == debt_id))
    debt = result.scalar_one()
    if name is not None: debt.name = name
    if balance is not None: debt.balance = Decimal(str(balance))
    if minimum_payment is not None: debt.minimum_payment = Decimal(str(minimum_payment))
    if interest_rate is not None: debt.interest_rate = Decimal(str(interest_rate))
    if account_type is not None: debt.account_type = account_type
    if due_date_day is not None: debt.due_date_day = due_date_day
    if statement_date_day is not None: debt.statement_date_day = statement_date_day
    if total_installments is not None: debt.total_installments = total_installments
    if installments_paid is not None: debt.installments_paid = installments_paid
    if original_balance is not None: debt.original_balance = Decimal(str(original_balance))
    if credit_limit is not None: debt.credit_limit = Decimal(str(credit_limit))
    await db.commit()
    await db.refresh(debt)
    return _serialize(debt)


async def delete_debt(debt_id: str, db: AsyncSession) -> None:
    result = await db.execute(select(DebtAccount).where(DebtAccount.id == debt_id))
    debt = result.scalar_one()
    if debt.bank_account_id:
        # Auto-created from a linked Plaid account — hide it instead of a hard
        # delete, so the next sync doesn't just re-add it.
        debt.dismissed = True
    else:
        await db.delete(debt)
    await db.commit()


async def add_payment(debt_id: str, amount: float, paid_on: date, note: str | None, db: AsyncSession) -> dict[str, Any]:
    result = await db.execute(select(DebtAccount).where(DebtAccount.id == debt_id))
    debt = result.scalar_one()
    payment = DebtPayment(debt_id=debt_id, amount=Decimal(str(amount)), paid_on=paid_on, note=note)
    db.add(payment)
    new_balance = max(float(debt.balance) - amount, 0)
    debt.balance = Decimal(str(new_balance))
    if new_balance <= 0:
        debt.is_paid_off = True
    if debt.total_installments:
        debt.installments_paid = min(debt.installments_paid + 1, debt.total_installments)
    await db.commit()
    await db.refresh(payment)
    return {"id": str(payment.id), "amount": amount, "paid_on": paid_on.isoformat(), "note": note}


async def get_debt_budget_extras(db: AsyncSession) -> dict[str, float]:
    """Amounts budgeted above each debt's minimum payment this calendar month,
    read from the Debt group's auto-synced budget categories (see
    budget_service._sync_debt_categories, which never overwrites a category's
    budgeted amount once created — so a user raising it above the minimum
    payment to plan an extra payment sticks there). Returns {} if no budget
    exists yet for the current month; doesn't create one as a side effect of
    just viewing the payoff plan."""
    today = date.today()
    result = await db.execute(
        select(BudgetMonth).where(BudgetMonth.year == today.year, BudgetMonth.month == today.month)
    )
    bm = result.scalar_one_or_none()
    if not bm:
        return {}
    result = await db.execute(
        select(BudgetCategory, DebtAccount.minimum_payment)
        .join(BudgetGroup, BudgetCategory.group_id == BudgetGroup.id)
        .join(DebtAccount, BudgetCategory.debt_account_id == DebtAccount.id)
        .where(BudgetGroup.budget_month_id == bm.id, BudgetCategory.debt_account_id.isnot(None))
    )
    extras: dict[str, float] = {}
    for cat, min_payment in result.all():
        extra = float(cat.budgeted) - float(min_payment or 0)
        if extra > 0:
            extras[str(cat.debt_account_id)] = extra
    return extras


async def compute_payoff_plan(extra_monthly: float, strategy: str, db: AsyncSession) -> dict[str, Any]:
    result = await db.execute(select(DebtAccount).where(DebtAccount.is_paid_off == False).order_by(DebtAccount.sort_order))
    debts = list(result.scalars().all())
    if not debts:
        return {"debts": [], "total_months": 0, "total_interest": 0.0, "strategy": strategy, "total_budgeted_extra": 0.0}
    budget_extras = await get_debt_budget_extras(db)
    ordered = sorted(debts, key=lambda d: float(d.balance)) if strategy == "snowball" else sorted(debts, key=lambda d: float(d.interest_rate), reverse=True)
    balances = {d.id: float(d.balance) for d in ordered}
    rates = {d.id: float(d.interest_rate) / 100 / 12 for d in ordered}
    # Whatever's already budgeted above the minimum (planned in the Budget
    # page) is paid automatically every month in the simulation, on top of
    # the required minimum; `extra_monthly` (typed on this page) is separate,
    # additional cash distributed across debts per the snowball/avalanche
    # strategy below.
    mins = {d.id: float(d.minimum_payment) + budget_extras.get(str(d.id), 0) for d in ordered}
    payoff_month: dict[str, int] = {}
    total_interest = 0.0
    month = 0
    max_months = 600
    while any(balances[d.id] > 0.01 for d in ordered) and month < max_months:
        month += 1
        freed = 0.0
        for d in ordered:
            if balances[d.id] <= 0: continue
            interest = balances[d.id] * rates[d.id]
            total_interest += interest
            balances[d.id] += interest
        available = extra_monthly
        for d in ordered:
            if balances[d.id] <= 0: continue
            pay = min(mins[d.id], balances[d.id])
            balances[d.id] -= pay
            if balances[d.id] <= 0:
                freed += mins[d.id] - pay
                payoff_month[d.id] = month
        remaining_extra = available + freed
        for d in ordered:
            if remaining_extra <= 0:
                break
            if balances[d.id] <= 0:
                continue
            extra_apply = min(remaining_extra, balances[d.id])
            balances[d.id] -= extra_apply
            remaining_extra -= extra_apply
            if balances[d.id] <= 0:
                payoff_month[d.id] = month
    plan = [{"id": str(d.id), "name": d.name, "balance": float(d.balance), "minimum_payment": float(d.minimum_payment),
              "interest_rate": float(d.interest_rate), "payoff_month": payoff_month.get(d.id, max_months),
              "budgeted_extra": round(budget_extras.get(str(d.id), 0), 2)} for d in ordered]
    return {"debts": plan, "total_months": month, "total_interest": round(total_interest, 2), "strategy": strategy,
            "total_budgeted_extra": round(sum(budget_extras.values()), 2)}


def _serialize(debt: DebtAccount, credit_limit: Optional[float] = None) -> dict[str, Any]:
    total_paid = sum(float(p.amount) for p in debt.payments) if debt.payments else 0
    payoff = _estimate_payoff(float(debt.balance), float(debt.interest_rate), float(debt.minimum_payment))
    original_balance = float(debt.original_balance) if debt.original_balance is not None else float(debt.balance) + total_paid
    return {"id": str(debt.id), "name": debt.name, "balance": float(debt.balance),
            "original_balance": original_balance,
            "minimum_payment": float(debt.minimum_payment), "interest_rate": float(debt.interest_rate),
            "account_type": debt.account_type, "due_date_day": debt.due_date_day, "statement_date_day": debt.statement_date_day,
            "sort_order": debt.sort_order, "is_paid_off": debt.is_paid_off, "total_paid": total_paid,
            "is_synced": debt.bank_account_id is not None,
            "credit_limit": credit_limit,
            "total_installments": debt.total_installments, "installments_paid": debt.installments_paid,
            "expected_payoff_months": payoff["months"], "expected_payoff_date": payoff["date"],
            "payments": [{"id": str(p.id), "amount": float(p.amount), "paid_on": p.paid_on.isoformat(), "note": p.note} for p in (debt.payments or [])]}
