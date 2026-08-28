"""Which Dave Ramsey Baby Step the user is on, derived from their real data.

Deterministic — no LLM call — so the home screen can always show a concrete
"do this next" without cost or latency. The AI coach handles open questions;
this answers the single recurring one: what should I focus on right now?
"""
from __future__ import annotations

import calendar
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db.models import DebtAccount, SavingsGoal, Transaction

STARTER_EMERGENCY_FUND = 1000.0

# Steps 5-7 (kids' college, pay off the house, build wealth) aren't derivable
# from anything the app tracks, so the ladder stops at 4 and says so.
_STEP_TITLES = {
    1: "Save $1,000 starter emergency fund",
    2: "Pay off all debt with the snowball",
    3: "Build 3–6 months of expenses",
    4: "Invest 15% of income for retirement",
}


def _fmt(n: float) -> str:
    return f"${n:,.0f}"


async def get_baby_step(user_id: str, db: AsyncSession) -> dict:
    today = date.today()

    # Emergency fund balance, from the same goal the Emergency page maintains.
    result = await db.execute(
        select(SavingsGoal).where(SavingsGoal.user_id == user_id, SavingsGoal.name == "Emergency Fund")
    )
    ef_goal = result.scalar_one_or_none()
    ef = float(ef_goal.current_amount) if ef_goal else 0.0

    # Non-mortgage debt — the snowball explicitly excludes the house.
    result = await db.execute(
        select(DebtAccount).where(
            DebtAccount.user_id == user_id,
            DebtAccount.is_paid_off == False,  # noqa: E712
            DebtAccount.dismissed == False,  # noqa: E712
        )
    )
    debts = [d for d in result.scalars().all() if (d.account_type or "").lower() != "mortgage"]
    total_debt = sum(float(d.balance) for d in debts)
    smallest = min(debts, key=lambda d: float(d.balance)) if debts else None

    # Average monthly spend over the last 3 full months, for the 3-6 month target.
    months: list[float] = []
    for i in range(1, 4):
        m, y = today.month - i, today.year
        while m <= 0:
            m += 12
            y -= 1
        start = date(y, m, 1)
        end = date(y, m, calendar.monthrange(y, m)[1])
        result = await db.execute(
            select(Transaction).where(
                Transaction.user_id == user_id,
                Transaction.date >= start, Transaction.date <= end,
                Transaction.pending == False,  # noqa: E712
                Transaction.amount > 0,
            )
        )
        months.append(sum(float(t.amount) for t in result.scalars().all()))
    spending_months = [m for m in months if m > 0]
    monthly_expenses = sum(spending_months) / len(spending_months) if spending_months else 0.0

    # --- Which step? ------------------------------------------------------
    if ef < STARTER_EMERGENCY_FUND:
        remaining = STARTER_EMERGENCY_FUND - ef
        return {
            "step": 1,
            "title": _STEP_TITLES[1],
            "why": "A starter fund keeps the next surprise from becoming new debt.",
            "action": f"Put {_fmt(remaining)} more into your emergency fund.",
            "progress": ef,
            "target": STARTER_EMERGENCY_FUND,
            "href": "/emergency",
            "cta": "Add to fund",
        }

    if total_debt > 0:
        action = (
            f"Attack {smallest.name} next — it's the smallest at {_fmt(float(smallest.balance))}."
            if smallest else "Put every spare dollar at your smallest debt."
        )
        # Progress from original_balance rather than the payments relationship,
        # which is lazy-loaded and would raise outside a greenlet context.
        original_total = sum(
            float(d.original_balance) if d.original_balance is not None else float(d.balance)
            for d in debts
        )
        paid = max(0.0, original_total - total_debt)
        return {
            "step": 2,
            "title": _STEP_TITLES[2],
            "why": "Smallest balance first — quick wins keep the momentum going.",
            "action": action,
            "progress": paid,
            "target": original_total,
            "detail": f"{_fmt(total_debt)} across {len(debts)} debt{'s' if len(debts) != 1 else ''}",
            "href": "/debt",
            "cta": "See payoff plan",
        }

    if monthly_expenses > 0:
        full_target = monthly_expenses * 3
        if ef < full_target:
            return {
                "step": 3,
                "title": _STEP_TITLES[3],
                "why": "Debt-free — now make the fund deep enough for a job loss, not just a flat tire.",
                "action": f"Build toward {_fmt(full_target)} (3 months at {_fmt(monthly_expenses)}/mo).",
                "progress": ef,
                "target": full_target,
                "href": "/emergency",
                "cta": "Add to fund",
            }

    return {
        "step": 4,
        "title": _STEP_TITLES[4],
        "why": "No debt and a full emergency fund — the hard part is behind you.",
        "action": "Put 15% of your income toward retirement, then keep building.",
        "progress": None,
        "target": None,
        "href": "/goals",
        "cta": "Set a goal",
    }
