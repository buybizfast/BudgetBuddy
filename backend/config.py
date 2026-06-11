from __future__ import annotations
import os

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://budgetbuddy:budgetbuddy@localhost/budgetbuddy")
PLAID_CLIENT_ID = os.getenv("PLAID_CLIENT_ID", "")
PLAID_SECRET = os.getenv("PLAID_SECRET", "")
PLAID_ENV = os.getenv("PLAID_ENV", "sandbox")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:3001").split(",")
BUDGET_SYNC_INTERVAL_SECS = int(os.getenv("BUDGET_SYNC_INTERVAL_SECS", "900"))
