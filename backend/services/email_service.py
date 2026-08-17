"""Transactional email via Resend. Logs instead of sending when
RESEND_API_KEY isn't set, so local dev works without a real account."""
from __future__ import annotations

import logging

from backend.config import FRONTEND_URL, RESEND_API_KEY, RESEND_FROM_EMAIL

log = logging.getLogger("services.email")


def _send(to: str, subject: str, html: str) -> None:
    if not RESEND_API_KEY:
        log.warning("RESEND_API_KEY not set — logging email instead of sending. To: %s Subject: %s\n%s", to, subject, html)
        return
    import resend
    resend.api_key = RESEND_API_KEY
    try:
        resend.Emails.send({
            "from": RESEND_FROM_EMAIL,
            "to": [to],
            "subject": subject,
            "html": html,
        })
    except Exception as exc:
        log.error("Failed to send email to %s: %s", to, exc)


def send_password_reset_email(to: str, raw_token: str) -> None:
    reset_url = f"{FRONTEND_URL}/reset-password?token={raw_token}"
    html = f"""
    <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color: #1a2e4a;">Reset your Budget Buddy password</h2>
      <p>Someone requested a password reset for this account. If this was you, click below —
      this link expires in 30 minutes.</p>
      <p style="margin: 24px 0;">
        <a href="{reset_url}" style="background:#1a2e4a;color:#fff;padding:12px 24px;
           border-radius:12px;text-decoration:none;font-weight:600;">Reset Password</a>
      </p>
      <p style="color:#888;font-size:13px;">If you didn't request this, you can safely ignore this email —
      your password won't change.</p>
    </div>
    """
    _send(to, "Reset your Budget Buddy password", html)


def send_welcome_email(to: str) -> None:
    html = """
    <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color: #1a2e4a;">Welcome to Budget Buddy!</h2>
      <p>Your account is ready. Connect a bank account and start budgeting.</p>
    </div>
    """
    _send(to, "Welcome to Budget Buddy", html)
