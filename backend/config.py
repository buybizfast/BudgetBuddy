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
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:3001").split(",")
BUDGET_SYNC_INTERVAL_SECS = int(os.getenv("BUDGET_SYNC_INTERVAL_SECS", "900"))

AUTH_USERNAME = os.getenv("AUTH_USERNAME", "admin")
AUTH_PASSWORD = os.getenv("AUTH_PASSWORD", "budgetbuddy")
# Falls back to a random secret if unset, which invalidates all sessions
# on every process restart — set JWT_SECRET explicitly in production.
JWT_SECRET = os.getenv("JWT_SECRET", secrets.token_hex(32))
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "10080"))  # 7 days

# Plaid token encryption — generate with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
# If not set, tokens are stored unencrypted (development only).
TOKEN_ENCRYPTION_KEY = os.getenv("TOKEN_ENCRYPTION_KEY", "")
