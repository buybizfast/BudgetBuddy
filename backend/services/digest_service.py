"""Weekly digest email: a Monday-morning summary of the past week's spending,
upcoming bills, safe-to-spend, and debt progress, sent via Resend."""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import RESEND_API_KEY, RESEND_FROM_EMAIL, DIGEST_EMAIL
from backend.db.models import AppState, DebtAccount, Transaction

log = logging.getLogger("services.digest")


def _fmt(n: float) -> str:
    return f"${n:,.2f}"


async def build_digest(db: AsyncSession) -> tuple[str, str]:
    """Return (subject, html) for this week's digest."""
    from api.routes.bills import get_upcoming_unpaid
    from api.routes.safe_to_spend import get_safe_to_spend

    today = date.today()
    week_ago = today - timedelta(days=7)

    txn_result = await db.execute(
        select(Transaction).where(
            Transaction.date >= week_ago, Transaction.date < today,
            Transaction.pending == False,  # noqa: E712
        )
    )
    txns = txn_result.scalars().all()
    spent = sum(float(t.amount) for t in txns if float(t.amount) > 0)
    income = sum(-float(t.amount) for t in txns if float(t.amount) < 0)

    # Top merchants by spend
    by_merchant: dict[str, float] = {}
    for t in txns:
        amt = float(t.amount)
        if amt <= 0:
            continue
        name = t.merchant_name or t.name or "Unknown"
        by_merchant[name] = by_merchant.get(name, 0) + amt
    top_merchants = sorted(by_merchant.items(), key=lambda kv: kv[1], reverse=True)[:5]

    bills = await get_upcoming_unpaid(days_ahead=7, db=db)
    bills_total = sum(b["amount"] for b in bills)

    sts = await get_safe_to_spend(db=db)

    debt_result = await db.execute(select(DebtAccount).where(DebtAccount.is_paid_off == False))  # noqa: E712
    total_debt = sum(float(d.balance) for d in debt_result.scalars().all())

    subject = f"Your week: {_fmt(spent)} spent · {len(bills)} bill{'s' if len(bills) != 1 else ''} coming up"

    def row(label: str, value: str, color: str = "#111827") -> str:
        return (
            f'<tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">{label}</td>'
            f'<td style="padding:6px 0;text-align:right;font-weight:700;font-size:14px;color:{color};">{value}</td></tr>'
        )

    merchant_rows = "".join(
        row(name, _fmt(amt)) for name, amt in top_merchants
    ) or row("No spending recorded", "—")

    bill_rows = "".join(
        row(f"{b['merchant']} · {b['due_date']}", _fmt(b["amount"])) for b in bills
    ) or row("Nothing due this week", "—")

    safe = sts["safe_to_spend"]
    safe_color = "#dc2626" if safe < 0 else "#d97706" if safe < 100 else "#059669"

    html = f"""
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px 16px;background:#f9fafb;">
  <div style="text-align:center;margin-bottom:20px;">
    <div style="font-size:28px;">🐷</div>
    <h1 style="font-size:20px;margin:4px 0;color:#111827;">Your BudgetBuddy Week</h1>
    <p style="color:#6b7280;font-size:13px;margin:0;">{week_ago.strftime('%b %-d')} – {(today - timedelta(days=1)).strftime('%b %-d, %Y')}</p>
  </div>

  <div style="background:#ffffff;border-radius:16px;padding:20px;margin-bottom:14px;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
    <p style="margin:0;color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;">Safe to Spend</p>
    <p style="margin:4px 0 0;font-size:30px;font-weight:800;color:{safe_color};">{_fmt(safe)}</p>
    <p style="margin:4px 0 0;color:#9ca3af;font-size:12px;">{_fmt(sts['cash'])} cash − {_fmt(sts['upcoming_bills_total'])} in upcoming bills</p>
  </div>

  <div style="background:#ffffff;border-radius:16px;padding:20px;margin-bottom:14px;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
    <h2 style="font-size:14px;margin:0 0 8px;color:#111827;">This week</h2>
    <table style="width:100%;border-collapse:collapse;">
      {row("Spent", _fmt(spent), "#dc2626")}
      {row("Income received", _fmt(income), "#059669")}
      {row("Total debt", _fmt(total_debt))}
    </table>
  </div>

  <div style="background:#ffffff;border-radius:16px;padding:20px;margin-bottom:14px;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
    <h2 style="font-size:14px;margin:0 0 8px;color:#111827;">Top spending</h2>
    <table style="width:100%;border-collapse:collapse;">{merchant_rows}</table>
  </div>

  <div style="background:#ffffff;border-radius:16px;padding:20px;margin-bottom:14px;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
    <h2 style="font-size:14px;margin:0 0 8px;color:#111827;">Bills due this week — {_fmt(bills_total)}</h2>
    <table style="width:100%;border-collapse:collapse;">{bill_rows}</table>
  </div>

  <p style="text-align:center;color:#9ca3af;font-size:11px;margin-top:20px;">
    Sent by BudgetBuddy · your money, on autopilot
  </p>
</div>
"""
    return subject, html


async def send_weekly_digest(db: AsyncSession) -> bool:
    """Build and send the digest. Returns True if actually sent."""
    if not RESEND_API_KEY or not DIGEST_EMAIL:
        log.info("Digest skipped — RESEND_API_KEY or DIGEST_EMAIL not set")
        return False

    subject, html = await build_digest(db)
    try:
        import resend
        resend.api_key = RESEND_API_KEY
        resend.Emails.send({
            "from": RESEND_FROM_EMAIL,
            "to": [DIGEST_EMAIL],
            "subject": subject,
            "html": html,
        })
        log.info("Weekly digest sent to %s", DIGEST_EMAIL)
        return True
    except Exception as exc:
        log.error("Failed to send weekly digest: %s", exc)
        return False


def _iso_week(d: date) -> str:
    y, w, _ = d.isocalendar()
    return f"{y}-W{w:02d}"


async def maybe_send_weekly_digest(db: AsyncSession) -> None:
    """Send the digest if it's Monday (13:00 UTC or later ≈ morning in the US)
    and this ISO week's digest hasn't been sent yet. Safe to call repeatedly."""
    now = datetime.utcnow()
    if now.weekday() != 0 or now.hour < 13:
        return

    week = _iso_week(now.date())
    result = await db.execute(select(AppState).where(AppState.key == "digest_last_sent_week"))
    state = result.scalar_one_or_none()
    if state and state.value == week:
        return

    if await send_weekly_digest(db):
        if state is None:
            state = AppState(key="digest_last_sent_week", value=week)
            db.add(state)
        else:
            state.value = week
            state.updated_at = datetime.utcnow()
        await db.commit()
