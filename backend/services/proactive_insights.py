"""Proactive insight flags for the home screen.

Rule-based checks over the user's live data — utilization spikes, budget
pace problems, duplicate charges — returned as structured alerts the UI can
render. Deterministic and free (no LLM calls); the AI coach is for
conversation, this is for surfacing problems unprompted.
"""
from __future__ import annotations

import calendar
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db.models import DebtAccount, Transaction
from backend.services.budget_service import get_budget_month_with_spending


def _alert(severity: str, title: str, detail: str, href: str) -> dict:
    return {"severity": severity, "title": title, "detail": detail, "href": href}


async def get_proactive_alerts(db: AsyncSession) -> list[dict]:
    today = date.today()
    alerts: list[dict] = []

    # --- Credit utilization ------------------------------------------------
    result = await db.execute(
        select(DebtAccount).where(
            DebtAccount.account_type == "credit_card",
            DebtAccount.is_paid_off == False,  # noqa: E712
            DebtAccount.credit_limit.isnot(None),
        )
    )
    cards = result.scalars().all()
    for card in cards:
        limit = float(card.credit_limit or 0)
        if limit <= 0:
            continue
        pct = float(card.balance) / limit * 100
        if pct >= 70:
            alerts.append(_alert(
                "alert", f"{card.name} is at {pct:.0f}% utilization",
                "Above 70% seriously hurts your credit score. Paying it below 30% should be a top priority.",
                "/debt",
            ))
        elif pct >= 30:
            alerts.append(_alert(
                "warn", f"{card.name} is at {pct:.0f}% utilization",
                "Keeping cards under 30% protects your credit score.",
                "/debt",
            ))

    # --- Budget pace -------------------------------------------------------
    try:
        budget = await get_budget_month_with_spending(today.year, today.month, db)
    except Exception:
        budget = {}
    days_in_month = calendar.monthrange(today.year, today.month)[1]
    month_pct = today.day / days_in_month * 100

    over, pacing = [], []
    for g in budget.get("groups", []):
        for c in g.get("categories", []):
            budgeted = c.get("budgeted", 0)
            spent = c.get("spent", 0)
            if budgeted <= 0:
                continue
            spent_pct = spent / budgeted * 100
            name = f"{g['name']} › {c['name']}"
            if spent > budgeted:
                over.append((name, spent - budgeted))
            elif spent_pct > month_pct + 25 and spent_pct >= 70:
                pacing.append((name, spent_pct))

    over.sort(key=lambda x: x[1], reverse=True)
    for name, over_by in over[:3]:
        alerts.append(_alert(
            "alert", f"{name} is over budget",
            f"${over_by:,.2f} over with {days_in_month - today.day} days left in the month.",
            "/budget",
        ))
    pacing.sort(key=lambda x: x[1], reverse=True)
    for name, spent_pct in pacing[:2]:
        alerts.append(_alert(
            "warn", f"{name} is {spent_pct:.0f}% used",
            f"The month is only {month_pct:.0f}% done — at this pace it will run out early.",
            "/budget",
        ))

    # --- Possible duplicate charges ---------------------------------------
    window_start = today - timedelta(days=5)
    result = await db.execute(
        select(Transaction).where(
            Transaction.date >= window_start,
            Transaction.amount > 0,
        )
    )
    seen: dict[tuple[str, float], list[date]] = {}
    for t in result.scalars().all():
        name = (t.merchant_name or t.name or "").strip().lower()
        if not name:
            continue
        seen.setdefault((name, float(t.amount)), []).append(t.date)
    for (name, amount), dates in seen.items():
        if len(dates) >= 2:
            alerts.append(_alert(
                "warn", f"Possible double charge: {name.title()}",
                f"Charged ${amount:,.2f} {len(dates)} times in the last 5 days ({', '.join(d.strftime('%b %-d') for d in sorted(dates))}). Worth checking.",
                "/transactions",
            ))

    # Highest severity first, cap the list so the card stays scannable.
    severity_rank = {"alert": 0, "warn": 1, "info": 2}
    alerts.sort(key=lambda a: severity_rank.get(a["severity"], 3))
    return alerts[:6]
