"""AI-powered spending insights using Claude."""
from __future__ import annotations

from typing import Any
from sqlalchemy.ext.asyncio import AsyncSession
from backend.services.budget_service import get_budget_month_with_spending


async def generate_insights(year: int, month: int, db: AsyncSession) -> str:
    budget = await get_budget_month_with_spending(year, month, db)

    from backend.config import ANTHROPIC_API_KEY
    if not ANTHROPIC_API_KEY:
        return _template_insights(budget)

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        summary_lines = [f"Month: {year}-{month:02d}", f"Income: ${budget['total_income']:.2f}",
                         f"Budgeted: ${budget['total_budgeted']:.2f}", f"Spent: ${budget['total_spent']:.2f}",
                         f"Left to budget: ${budget['left_to_budget']:.2f}", "", "Category spending:"]
        for group in budget["groups"]:
            if group["spent"] > 0 or group["budgeted"] > 0:
                summary_lines.append(f"  {group['name']}: spent ${group['spent']:.2f} of ${group['budgeted']:.2f} budgeted")
        prompt = "\n".join(summary_lines)
        message = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=500,
            messages=[{"role": "user", "content": f"You are a friendly personal finance coach in the Dave Ramsey style. Analyze this monthly budget and give 3-4 specific, actionable tips. Be encouraging but direct. Keep it under 200 words.\n\n{prompt}"}]
        )
        return message.content[0].text
    except Exception:
        return _template_insights(budget)


def _template_insights(budget: dict) -> str:
    lines = []
    left = budget["left_to_budget"]
    if left > 0:
        lines.append(f"You have ${left:.2f} left to assign — give every dollar a job to reach zero-based budgeting!")
    elif left < 0:
        lines.append(f"You're ${abs(left):.2f} over your income — review your categories and trim where possible.")
    else:
        lines.append("Perfect zero-based budget! Every dollar has a job.")
    over_groups = [g for g in budget["groups"] if g["spent"] > g["budgeted"] and g["budgeted"] > 0]
    if over_groups:
        names = ", ".join(g["name"] for g in over_groups[:3])
        lines.append(f"Over budget in: {names}. Consider adjusting these categories or cutting back.")
    if budget["total_income"] > 0:
        savings_pct = sum(g["budgeted"] for g in budget["groups"] if g["name"] == "Savings") / budget["total_income"] * 100
        if savings_pct < 10:
            lines.append("Dave Ramsey recommends saving at least 15% of income. Consider increasing your Savings allocation.")
    return "\n\n".join(lines) or "Enter your income and budget amounts to get personalized insights."
