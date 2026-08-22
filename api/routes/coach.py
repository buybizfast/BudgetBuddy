"""Financial Coach — Claude-powered advice grounded in the user's real data."""
from __future__ import annotations

import calendar
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from slowapi import Limiter
from slowapi.util import get_remote_address

_limiter = Limiter(key_func=get_remote_address)
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.auth import get_current_user
from backend.config import ANTHROPIC_API_KEY
from backend.db.base import get_session
from backend.db.models import BankAccount, DebtAccount, SavingsGoal, Transaction
from backend.services.budget_service import get_budget_month_with_spending

router = APIRouter(prefix="/api/v1/coach", tags=["coach"])

SYSTEM_PROMPT = """\
You are BudgetBuddy Coach, a friendly financial advisor who follows Dave Ramsey's \
Baby Steps methodology strictly. You have access to the user's real financial data \
provided in each message. Use it to give specific, personalized advice.

Dave Ramsey's Baby Steps:
1. Save $1,000 starter emergency fund
2. Pay off all debt (except mortgage) using the debt snowball (smallest balance first)
3. Build 3–6 months of expenses in a full emergency fund
4. Invest 15% of household income in retirement
5. Save for kids' college
6. Pay off the home early
7. Build wealth and give generously

Guidelines:
- Be warm, encouraging, and direct — like Dave himself
- Always reference the user's actual numbers (income, debt balances, categories)
- Keep responses concise and actionable (3–6 sentences or a short bulleted list)
- Use markdown formatting (bold, bullet points) for readability
- Never recommend debt consolidation loans, balance transfers as a solution, or index \
funds until Baby Step 4
- If the user asks something unrelated to personal finance, gently redirect them
"""


async def _load_data(user_id: str, db: AsyncSession) -> dict:
    now = date.today()
    year, month = now.year, now.month

    try:
        budget = await get_budget_month_with_spending(user_id, year, month, db)
    except Exception:
        budget = {}

    debts_result = await db.execute(select(DebtAccount).where(DebtAccount.user_id == user_id, DebtAccount.is_paid_off == False).order_by(DebtAccount.balance))
    debts = debts_result.scalars().all()

    goals_result = await db.execute(select(SavingsGoal).where(SavingsGoal.user_id == user_id))
    goals = goals_result.scalars().all()

    start = date(year, month, 1)
    end = date(year, month, calendar.monthrange(year, month)[1])
    txn_result = await db.execute(
        select(Transaction)
        .where(Transaction.user_id == user_id, Transaction.date >= start, Transaction.date <= end, Transaction.pending == False)
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


def _build_context(d: dict) -> str:
    """Serialize the user's financial snapshot into a text block for Claude."""
    def fmt(n): return f"${n:,.2f}"

    lines = ["=== USER'S CURRENT FINANCIAL DATA ==="]
    lines.append(f"Month: {date.today().strftime('%B %Y')}")
    lines.append(f"Income: {fmt(d['income'])}")
    lines.append(f"Total spent: {fmt(d['spent'])}")
    lines.append(f"Left to budget: {fmt(d['left'])}")

    if d["over_cats"]:
        lines.append("\nOver-budget categories:")
        for c in d["over_cats"]:
            lines.append(f"  - {c['name']}: budgeted {fmt(c['budgeted'])}, spent {fmt(c['spent'])}, over by {fmt(c['over_by'])}")
    else:
        lines.append("\nNo over-budget categories this month.")

    lines.append(f"\nEmergency fund: {fmt(d['ef_amount'])} / {fmt(d['ef_target'])} target")

    if d["debts"]:
        lines.append(f"\nDebts (smallest to largest — snowball order):")
        for debt in d["debts"]:
            lines.append(f"  - {debt.name}: balance {fmt(float(debt.balance))}, min payment {fmt(float(debt.minimum_payment))}/mo, rate {debt.interest_rate}%")
        lines.append(f"Total debt: {fmt(d['total_debt'])}")
    else:
        lines.append("\nNo outstanding debts.")

    if d["goals"]:
        lines.append("\nSavings goals:")
        for g in d["goals"]:
            pct = (float(g.current_amount) / float(g.target_amount) * 100) if float(g.target_amount) > 0 else 0
            lines.append(f"  - {g.name}: {fmt(float(g.current_amount))} / {fmt(float(g.target_amount))} ({pct:.0f}%)")

    budget = d.get("budget", {})
    groups = budget.get("groups", [])
    if groups:
        lines.append("\nBudget categories:")
        for g in groups:
            for c in g.get("categories", []):
                lines.append(f"  - {g['name']} › {c['name']}: budgeted {fmt(c.get('budgeted', 0))}, spent {fmt(c.get('spent', 0))}")

    lines.append("=== END FINANCIAL DATA ===")
    return "\n".join(lines)


class ChatRequest(BaseModel):
    message: str
    history: Optional[list] = None


@router.post("/chat")
@_limiter.limit("30/minute")
async def chat(request: Request, body: ChatRequest, user_id: str = Depends(get_current_user), db: AsyncSession = Depends(get_session)):
    if not ANTHROPIC_API_KEY:
        raise HTTPException(status_code=503, detail="AI coach is not configured. Set ANTHROPIC_API_KEY in your environment.")

    data = await _load_data(user_id, db)
    context = _build_context(data)

    # Build conversation history for multi-turn support
    messages = []
    if body.history:
        for turn in body.history[-10:]:  # keep last 10 turns to stay within context limits
            role = turn.get("role")
            content = turn.get("content", "")
            if role in ("user", "assistant") and content:
                messages.append({"role": role, "content": content})

    # Inject financial context into the latest user message
    user_content = f"{context}\n\nUser question: {body.message}"
    messages.append({"role": "user", "content": user_content})

    try:
        import anthropic
        client = anthropic.AsyncAnthropic(api_key=ANTHROPIC_API_KEY)
        resp = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            messages=messages,
        )
        response_text = resp.content[0].text
    except Exception as exc:
        import logging
        logging.getLogger("api.coach").error("AI coach request failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=502, detail=f"AI coach error: {exc}")

    return {"response": response_text}
