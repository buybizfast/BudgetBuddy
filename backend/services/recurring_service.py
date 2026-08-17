"""Detect recurring transactions (bills, subscriptions)."""
from __future__ import annotations

import re
from collections import defaultdict
from datetime import date, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db.models import Transaction


def _normalize(name: str) -> str:
    name = name.lower()
    name = re.sub(r'[^a-z0-9 ]', ' ', name)
    name = re.sub(r'\s+', ' ', name).strip()
    name = re.sub(r'\b\d+\b', '', name).strip()
    return name


def _detect_cadence(gaps: list[int]):
    if not gaps:
        return None
    avg = sum(gaps) / len(gaps)
    for label, days in [("weekly", 7), ("biweekly", 14), ("monthly", 30), ("quarterly", 91), ("annual", 365)]:
        if abs(avg - days) <= 5 and all(abs(g - days) <= 8 for g in gaps):
            return label, days
    return None


async def detect_recurring(user_id: str, db: AsyncSession, months_back: int = 6) -> list[dict[str, Any]]:
    cutoff = date.today() - timedelta(days=months_back * 30)
    result = await db.execute(
        select(Transaction).where(Transaction.user_id == user_id, Transaction.date >= cutoff, Transaction.pending == False, Transaction.amount > 0)
        .order_by(Transaction.date)
    )
    txns = result.scalars().all()
    by_merchant: dict[str, list[Transaction]] = defaultdict(list)
    for txn in txns:
        key = _normalize(txn.merchant_name or txn.name or "")
        if key:
            by_merchant[key].append(txn)
    patterns = []
    for merchant_key, txn_list in by_merchant.items():
        if len(txn_list) < 2:
            continue
        txn_list.sort(key=lambda t: t.date)
        gaps = [(txn_list[i].date - txn_list[i - 1].date).days for i in range(1, len(txn_list))]
        cadence = _detect_cadence(gaps)
        if not cadence:
            continue
        cadence_label, expected_days = cadence
        amounts = sorted([float(t.amount) for t in txn_list[-3:]])
        median_amount = amounts[len(amounts) // 2]
        annual_cost = median_amount * (365 / expected_days)
        name_counts: dict[str, int] = defaultdict(int)
        for t in txn_list:
            name_counts[t.merchant_name or t.name or merchant_key] += 1
        display_name = max(name_counts, key=lambda k: name_counts[k])
        last_date = txn_list[-1].date
        category_id = next((str(t.budget_category_id) for t in reversed(txn_list) if t.budget_category_id), None)
        patterns.append({"merchant": display_name, "cadence": cadence_label, "expected_days": expected_days,
                          "amount": round(median_amount, 2), "annual_cost": round(annual_cost, 2),
                          "occurrences": len(txn_list), "last_seen": last_date.isoformat(),
                          "next_expected": (last_date + timedelta(days=expected_days)).isoformat(),
                          "budget_category_id": category_id})
    patterns.sort(key=lambda p: p["annual_cost"], reverse=True)
    return patterns
