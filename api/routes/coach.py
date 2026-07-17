"""AI Financial Coach — streams Claude responses grounded in the user's real data."""
from __future__ import annotations

import calendar
from datetime import date, datetime
from typing import Optional

import anthropic
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import ANTHROPIC_API_KEY
from backend.db.base import get_session
from backend.db.models import BankAccount, BudgetMonth, DebtAccount, SavingsGoal, Transaction
from backend.services.budget_service import get_budget_month_with_spending

router = APIRouter(prefix="/api/v1/coach", tags=["coach"])


async def _build_context(db: AsyncSession) -> str:
    """Summarize the user's financial picture for the AI."""
    now = date.today()
    year, month = now.year, now.month

    try:
        budget = await get_budget_month_with_spending(year, month, db)
    except Exception:
        budget = {}

    debts_result = await db.execute(select(DebtAccount).where(DebtAccount.is_paid_off == False))
    debts = debts_result.scalars().all()

    goals_result = await db.execute(select(SavingsGoal))
    goals = goals_result.scalars().all()

    accounts_result = await db.execute(select(BankAccount).where(BankAccount.is_active == True))
    accounts = [a for a in accounts_result.scalars().all() if a.account_id != "manual-cash"]

    # Recent transactions (last 30 days)
    start = date(year, month, 1)
    end = date(year, month, calendar.monthrange(year, month)[1])
    txn_result = await db.execute(
        select(Transaction)
        .where(Transaction.date >= start, Transaction.date <= end, Transaction.pending == False)
        .order_by(Transaction.amount.desc())
        .limit(20)
    )
    top_txns = txn_result.scalars().all()

    lines = [
        f"Today: {now.strftime('%B %d, %Y')}",
        "",
        "=== THIS MONTH'S BUDGET ===",
        f"Income: ${budget.get('total_income', 0):,.2f}",
        f"Budgeted: ${budget.get('total_budgeted', 0):,.2f}",
        f"Spent: ${budget.get('total_spent', 0):,.2f}",
        f"Left to budget: ${budget.get('left_to_budget', 0):,.2f}",
    ]

    if budget.get("groups"):
        lines.append("\nCategory spending:")
        for g in budget["groups"]:
            for c in g.get("categories", []):
                if c.get("budgeted", 0) > 0 or c.get("spent", 0) > 0:
                    lines.append(f"  {g['name']} › {c['name']}: budgeted ${c.get('budgeted',0):,.0f}, spent ${c.get('spent',0):,.0f}")

    if accounts:
        lines.append("\n=== BANK ACCOUNTS ===")
        for a in accounts:
            lines.append(f"  {a.name} ({a.type}): ${float(a.current_balance):,.2f}")

    if debts:
        lines.append("\n=== DEBTS ===")
        for d in debts:
            lines.append(f"  {d.name}: ${float(d.balance):,.2f} at {float(d.interest_rate)*100:.2f}% APR (min ${float(d.minimum_payment):,.0f}/mo)")
        lines.append(f"Total debt: ${sum(float(d.balance) for d in debts):,.2f}")

    if goals:
        lines.append("\n=== SAVINGS GOALS ===")
        for g in goals:
            pct = (float(g.current_amount) / float(g.target_amount) * 100) if float(g.target_amount) > 0 else 0
            lines.append(f"  {g.icon} {g.name}: ${float(g.current_amount):,.0f} / ${float(g.target_amount):,.0f} ({pct:.0f}%)")

    if top_txns:
        lines.append("\n=== TOP TRANSACTIONS THIS MONTH ===")
        for t in top_txns[:10]:
            lines.append(f"  {t.date}: {t.merchant_name or t.name} — ${float(t.amount):,.2f}")

    return "\n".join(lines)


SYSTEM_PROMPT = """You are a warm, encouraging personal financial coach built into BudgetBuddy — a Dave Ramsey-style zero-based budgeting app.

You have access to the user's real financial data below. Use it to give specific, personalized advice. Always be:
- Encouraging and non-judgmental
- Specific (reference their actual numbers)
- Practical (give actionable next steps)
- Aligned with Dave Ramsey's Baby Steps when relevant

Dave Ramsey's Baby Steps:
1. Save $1,000 emergency fund
2. Pay off all debt (smallest to largest — debt snowball)
3. Build 3–6 months of expenses in emergency fund
4. Invest 15% of income into retirement
5. Save for kids' college
6. Pay off home early
7. Build wealth and give

Keep responses concise and friendly. Use bullet points for action items. If you don't know something, say so honestly.

USER'S FINANCIAL DATA:
{context}"""


class ChatRequest(BaseModel):
    message: str
    history: Optional[list] = None


@router.post("/chat")
async def chat(body: ChatRequest, db: AsyncSession = Depends(get_session)):
    if not ANTHROPIC_API_KEY:
        return {"error": "ANTHROPIC_API_KEY not configured. Add it to your .env file."}

    context = await _build_context(db)
    system = SYSTEM_PROMPT.replace("{context}", context)

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    messages = []
    for h in (body.history or []):
        if h.get("role") in ("user", "assistant") and h.get("content"):
            messages.append({"role": h["role"], "content": h["content"]})
    messages.append({"role": "user", "content": body.message})

    def stream():
        with client.messages.stream(
            model="claude-haiku-4-5-20251001",
            max_tokens=1024,
            system=system,
            messages=messages,
        ) as stream:
            for text in stream.text_stream:
                yield text

    return StreamingResponse(stream(), media_type="text/plain")
