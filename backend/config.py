from __future__ import annotations
import os
import secrets
from dotenv import load_dotenv

load_dotenv()

def _normalize_database_url(url: str) -> str:
    # Managed Postgres providers (Railway, Render, Heroku) hand out
    # postgres:// or postgresql:// URLs; SQLAlchemy's async engine needs
    # the asyncpg driver explicitly in the scheme.
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://") and "+asyncpg" not in url:
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url

DATABASE_URL = _normalize_database_url(
    os.getenv("DATABASE_URL", "postgresql+asyncpg://budgetbuddy:budgetbuddy@localhost/budgetbuddy")
)
PLAID_CLIENT_ID = os.getenv("PLAID_CLIENT_ID", "")
PLAID_SECRET = os.getenv("PLAID_SECRET", "")
PLAID_ENV = os.getenv("PLAID_ENV", "sandbox")
# Required for OAuth institutions (e.g. Chase) in production. Must exactly
# match a URI registered under Team Settings > API > Allowed redirect URIs
# in the Plaid dashboard.
PLAID_REDIRECT_URI = os.getenv("PLAID_REDIRECT_URI", "")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:3001").split(",")
BUDGET_SYNC_INTERVAL_SECS = int(os.getenv("BUDGET_SYNC_INTERVAL_SECS", "900"))

# Weekly digest email (Resend). Each user's digest goes to their own account
# email, so only the API key and sender address are configured here.
RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
RESEND_FROM_EMAIL = os.getenv("RESEND_FROM_EMAIL", "BudgetBuddy <onboarding@resend.dev>")
# Which email address inherits the data that existed before multi-user
# accounts. Leave unset and the first account created claims it.
OWNER_EMAIL = os.getenv("OWNER_EMAIL", "")
# Max AI coach messages per user per day. Bounds the worst case when the
# key is shared across beta testers; 0 disables the cap.
COACH_DAILY_LIMIT = int(os.getenv("COACH_DAILY_LIMIT", "25"))
# Google sign-in. The client id is also served to the frontend via
# /auth/config so the browser can render Google's button.
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
# When set, signup requires this code — keeps the app closed to invitees.
SIGNUP_INVITE_CODE = os.getenv("SIGNUP_INVITE_CODE", "")
# Falls back to a random secret if unset, which invalidates all sessions
# on every process restart — set JWT_SECRET explicitly in production.
JWT_SECRET = os.getenv("JWT_SECRET", secrets.token_hex(32))
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "10080"))  # 7 days

# Plaid token encryption — generate with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
# If not set, tokens are stored unencrypted (development only).
TOKEN_ENCRYPTION_KEY = os.getenv("TOKEN_ENCRYPTION_KEY", "")

# Transactional email (signup verification, password reset) via Resend.
# Get a key at https://resend.com/api-keys. RESEND_FROM_EMAIL must be on a
# domain you've verified with Resend (or use their onboarding@resend.dev
# sender for testing only). If RESEND_API_KEY is unset, emails are logged
# instead of sent — fine for local dev, not for production.
RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
RESEND_FROM_EMAIL = os.getenv("RESEND_FROM_EMAIL", "BudgetBuddy <onboarding@resend.dev>")
# Used to build links in emails (password reset, etc.) — set this to your
# deployed frontend URL, e.g. https://budget-buddy-tau-gilt.vercel.app
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")
