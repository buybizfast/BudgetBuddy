"""Financial Coach — rule-based advice grounded in the user's real data.
   Swap _rule_based_response() for a Claude API call when ready to go live.
"""
from __future__ import annotations

import calendar
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from slowapi import Limiter
from slowapi.util import get_remote_address

_limiter = Limiter(key_func=get_remote_address)
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db.base import get_session
from backend.db.models import BankAccount, DebtAccount, SavingsGoal, Transaction
from backend.services.budget_service import get_budget_month_with_spending

router = APIRouter(prefix="/api/v1/coach", tags=["coach"])


async def _load_data(db: AsyncSession) -> dict:
    now = date.today()
    year, month = now.year, now.month

    try:
        budget = await get_budget_month_with_spending(year, month, db)
    except Exception:
        budget = {}

    debts_result = await db.execute(select(DebtAccount).where(DebtAccount.is_paid_off == False).order_by(DebtAccount.balance))
    debts = debts_result.scalars().all()

    goals_result = await db.execute(select(SavingsGoal))
    goals = goals_result.scalars().all()

    start = date(year, month, 1)
    end = date(year, month, calendar.monthrange(year, month)[1])
    txn_result = await db.execute(
        select(Transaction)
        .where(Transaction.date >= start, Transaction.date <= end, Transaction.pending == False)
    )
    txns = txn_result.scalars().all()

    income = float(budget.get("total_income", 0))
    spent = float(budget.get("total_spent", 0))
    budgeted = float(budget.get("total_budgeted", 0))
    left = float(budget.get("left_to_budget", 0))
    total_debt = sum(float(d.balance) for d in debts)
    emergency = next((g for g in goals if g.name == "Emergency Fund"), None)
    ef_amount = float(emergency.current_amount) if emergency else 0
    ef_target = float(emergency.target_amount) if emergency else 1000

    # Category overspending
    over_cats = []
    for g in budget.get("groups", []):
        for c in g.get("categories", []):
            if c.get("budgeted", 0) > 0 and c.get("spent", 0) > c.get("budgeted", 0):
                over_cats.append({
                    "name": f"{g['name']} › {c['name']}",
                    "budgeted": c["budgeted"],
                    "spent": c["spent"],
                    "over_by": c["spent"] - c["budgeted"],
                })
    over_cats.sort(key=lambda x: x["over_by"], reverse=True)

    return {
        "income": income, "spent": spent, "budgeted": budgeted, "left": left,
        "total_debt": total_debt, "debts": debts, "goals": goals,
        "ef_amount": ef_amount, "ef_target": ef_target,
        "over_cats": over_cats, "txns": txns,
        "budget": budget,
    }


def _rule_based_response(question: str, d: dict) -> str:
    """Generate a personalized response based on the user's data and question."""
    q = question.lower()
    income = d["income"]
    spent = d["spent"]
    left = d["left"]
    total_debt = d["total_debt"]
    ef_amount = d["ef_amount"]
    ef_target = d["ef_target"]
    over_cats = d["over_cats"]
    debts = d["debts"]

    def fmt(n): return f"${n:,.0f}"
    def fmt2(n): return f"${n:,.2f}"

    # --- Emergency fund ---
    if any(w in q for w in ["emergency", "emergency fund", "baby step 1", "baby step 3"]):
        if ef_amount == 0:
            return (
                f"You haven't started your emergency fund yet — this is Baby Step 1! 🛡️\n\n"
                f"Dave Ramsey recommends saving $1,000 as a starter emergency fund first.\n\n"
                f"**Action steps:**\n"
                f"• Open the Emergency Fund tracker (home screen)\n"
                f"• Set your target to $1,000 to start\n"
                f"• Look at your budget — can you cut {fmt(100)}/month to build it faster?\n\n"
                f"Once you hit $1,000, focus on Baby Step 2: paying off all debt."
            )
        elif ef_amount < 1000:
            remaining = 1000 - ef_amount
            return (
                f"You're on your way! You have {fmt(ef_amount)} in your emergency fund. 🛡️\n\n"
                f"You need {fmt(remaining)} more to complete Baby Step 1 ($1,000 starter fund).\n\n"
                f"**To get there faster:**\n"
                f"• Try to add {fmt(remaining / 3)}/month for the next 3 months\n"
                f"{'• You have ' + fmt(left) + ' unbudgeted — put some toward your emergency fund!' if left > 0 else ''}"
            )
        elif ef_amount >= ef_target:
            return (
                f"Your emergency fund is fully funded at {fmt(ef_amount)}! 🎉\n\n"
                f"That's a huge milestone. You're protected against unexpected expenses.\n\n"
                f"**What's next:**\n"
                f"{'• Baby Step 2: Focus on paying off your ' + fmt(total_debt) + ' in debt using the debt snowball' if total_debt > 0 else '• Baby Step 4: Invest 15% of your income for retirement'}"
            )
        else:
            pct = (ef_amount / ef_target) * 100
            return (
                f"Your emergency fund is {pct:.0f}% funded — {fmt(ef_amount)} of {fmt(ef_target)}. 🛡️\n\n"
                f"You need {fmt(ef_target - ef_amount)} more to reach your goal.\n\n"
                f"Keep it up! Once fully funded you'll have a solid safety net."
            )

    # --- Debt questions ---
    if any(w in q for w in ["debt", "pay off", "snowball", "loan", "credit card", "baby step 2"]):
        if total_debt == 0:
            return "You have no debt! That's incredible — you're free! 🎉\n\nFocus on building wealth: Baby Step 4 (invest 15% for retirement) and Step 5/6."
        smallest = debts[0] if debts else None
        lines = [f"You have {fmt(total_debt)} in total debt across {len(debts)} account{'s' if len(debts) != 1 else ''}.\n"]
        lines.append("**Dave Ramsey's Debt Snowball:**")
        lines.append("List debts smallest to largest (ignoring interest rate). Pay minimums on all, attack the smallest with every extra dollar. The quick wins build momentum!\n")
        if smallest:
            lines.append(f"**Start here:** {smallest.name} — {fmt(float(smallest.balance))}")
            lines.append(f"Minimum payment: {fmt(float(smallest.minimum_payment))}/mo")
        if left > 0:
            lines.append(f"\nYou have {fmt(left)} unbudgeted this month — throw it at your smallest debt!")
        return "\n".join(lines)

    # --- Budget / spending questions ---
    if any(w in q for w in ["budget", "spending", "overspend", "track", "on track", "categories"]):
        if income == 0:
            return "You haven't set your income for this month yet. Go to the Budget page and tap the income field to get started!"
        spent_pct = (spent / income * 100) if income > 0 else 0
        lines = [f"**This month's snapshot:**"]
        lines.append(f"• Income: {fmt(income)}")
        lines.append(f"• Spent: {fmt(spent)} ({spent_pct:.0f}% of income)")
        lines.append(f"• Remaining: {fmt(income - spent)}\n")
        if over_cats:
            lines.append(f"**⚠️ You're over budget in {len(over_cats)} categor{'ies' if len(over_cats) != 1 else 'y'}:**")
            for c in over_cats[:3]:
                lines.append(f"• {c['name']}: budgeted {fmt(c['budgeted'])}, spent {fmt(c['spent'])} (over by {fmt(c['over_by'])})")
            lines.append("\nTry adjusting next month's budget or cutting spending in these areas.")
        else:
            lines.append("✅ You're within budget in all categories — great discipline!")
        if left > 0:
            lines.append(f"\nYou still have {fmt(left)} to assign. Give every dollar a job — that's zero-based budgeting!")
        return "\n".join(lines)

    # --- Savings questions ---
    if any(w in q for w in ["sav", "goal", "target"]):
        goals = d["goals"]
        if not goals:
            return "You haven't set up any savings goals yet.\n\nHead to the Goals page to create one — whether it's a vacation, new car, or home down payment. Having a specific target makes saving much easier!"
        lines = ["**Your savings goals:**"]
        for g in goals:
            pct = (float(g.current_amount) / float(g.target_amount) * 100) if float(g.target_amount) > 0 else 0
            lines.append(f"• {g.icon} {g.name}: {fmt(float(g.current_amount))} / {fmt(float(g.target_amount))} ({pct:.0f}%)")
        total_saved = sum(float(g.current_amount) for g in goals)
        lines.append(f"\nTotal saved across all goals: {fmt(total_saved)}")
        if left > 0:
            lines.append(f"\nYou have {fmt(left)} unbudgeted — consider putting some toward your goals!")
        return "\n".join(lines)

    # --- Income questions ---
    if any(w in q for w in ["income", "earn", "salary", "make"]):
        if income == 0:
            return "Your income isn't set for this month yet. Go to Budget and tap the income field to enter it."
        return (
            f"Your budgeted income this month is {fmt(income)}.\n\n"
            f"You've spent {fmt(spent)} so far ({(spent/income*100):.0f}% of income).\n\n"
            f"Dave Ramsey recommends giving every dollar a job. "
            f"{'You still have ' + fmt(left) + ' to assign!' if left > 0 else 'Great — your budget is fully assigned!'}"
        )

    # --- Default / general questions ---
    lines = []
    if income > 0:
        spent_pct = spent / income * 100
        lines.append(f"**This month:** {fmt(income)} income · {fmt(spent)} spent ({spent_pct:.0f}%)")
    if total_debt > 0:
        lines.append(f"**Total debt:** {fmt(total_debt)} across {len(debts)} account{'s' if len(debts) != 1 else ''}")
    if ef_amount > 0:
        lines.append(f"**Emergency fund:** {fmt(ef_amount)} saved")
    if over_cats:
        lines.append(f"**Watch out:** Over budget in {over_cats[0]['name']} by {fmt(over_cats[0]['over_by'])}")
    if left > 0:
        lines.append(f"**Unassigned:** {fmt(left)} still needs a job in your budget")
    lines.append("\n**Try asking me:**")
    lines.append("• Am I on track with my budget?")
    lines.append("• How should I pay off my debt?")
    lines.append("• How is my emergency fund doing?")
    lines.append("• Where am I overspending?")
    return "\n".join(lines) if lines else "Tell me what's on your mind financially and I'll help you out!"


class ChatRequest(BaseModel):
    message: str
    history: Optional[list] = None


@router.post("/chat")
@_limiter.limit("30/minute")
async def chat(request: Request, body: ChatRequest, db: AsyncSession = Depends(get_session)):
    data = await _load_data(db)
    response = _rule_based_response(body.message, data)
    return {"response": response}
