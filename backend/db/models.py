from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean, CheckConstraint, Column, Date, DateTime,
    ForeignKey, Integer, Numeric, String, Text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship

from backend.db.base import Base
from backend.db.encrypted_type import EncryptedString


def _uuid() -> str:
    return str(uuid.uuid4())


class User(Base):
    __tablename__ = "users"
    id = Column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    email = Column(String(255), unique=True, nullable=False, index=True)
    # Null for accounts created through Google — they authenticate via
    # google_sub instead and have no password to verify.
    password_hash = Column(String(255), nullable=True)
    # Google's stable subject id. Preferred over email for matching, since a
    # Google account's email can change while the subject never does.
    google_sub = Column(String(64), unique=True, nullable=True, index=True)
    email_verified = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)


class PasswordResetToken(Base):
    """Reset tokens are stored hashed (like passwords) — only the raw token
    in the emailed link can redeem it, never anything queryable from the DB."""
    __tablename__ = "password_reset_tokens"
    id = Column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    user_id = Column(UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token_hash = Column(String(128), nullable=False, unique=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    used_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)


class PlaidItem(Base):
    __tablename__ = "plaid_items"
    id = Column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    user_id = Column(UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    item_id = Column(String(200), unique=True, nullable=False)
    access_token = Column(EncryptedString(700), nullable=False)  # 700 chars to fit Fernet overhead
    institution_id = Column(String(100))
    institution_name = Column(String(200))
    status = Column(String(20), nullable=False, default="active")
    cursor = Column(String(500))
    last_sync_error = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    accounts = relationship("BankAccount", back_populates="plaid_item", cascade="all, delete-orphan")


class BankAccount(Base):
    __tablename__ = "bank_accounts"
    id = Column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    user_id = Column(UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    plaid_item_id = Column(UUID(as_uuid=False), ForeignKey("plaid_items.id", ondelete="CASCADE"), nullable=False)
    account_id = Column(String(200), unique=True, nullable=False)
    name = Column(String(200), nullable=False)
    official_name = Column(String(300))
    type = Column(String(50), nullable=False, default="depository")
    subtype = Column(String(50))
    current_balance = Column(Numeric(12, 2), nullable=False, default=0)
    available_balance = Column(Numeric(12, 2))
    credit_limit = Column(Numeric(12, 2), nullable=True)  # from Plaid balances.limit — credit cards only
    currency = Column(String(10), nullable=False, default="USD")
    mask = Column(String(10))
    is_active = Column(Boolean, nullable=False, default=True)
    institution_name = Column(String(200))
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    plaid_item = relationship("PlaidItem", back_populates="accounts")
    transactions = relationship("Transaction", back_populates="account")


class Transaction(Base):
    __tablename__ = "transactions"
    id = Column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    user_id = Column(UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    account_id = Column(UUID(as_uuid=False), ForeignKey("bank_accounts.id", ondelete="CASCADE"), nullable=False)
    plaid_transaction_id = Column(String(200), unique=True)
    amount = Column(Numeric(12, 2), nullable=False)
    date = Column(Date, nullable=False)
    name = Column(String(500), nullable=False, default="")
    merchant_name = Column(String(300))
    category = Column(String(200))
    category_id = Column(String(50))
    budget_category_id = Column(UUID(as_uuid=False), ForeignKey("budget_categories.id", ondelete="SET NULL"), nullable=True)
    pending = Column(Boolean, nullable=False, default=False)
    currency = Column(String(10), nullable=False, default="USD")
    payment_channel = Column(String(50))
    logo_url = Column(String(500))
    personal_finance_category = Column(String(100))
    meta = Column(JSONB, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    account = relationship("BankAccount", back_populates="transactions")
    budget_category = relationship("BudgetCategory", back_populates="transactions")


class BudgetMonth(Base):
    __tablename__ = "budget_months"
    id = Column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    user_id = Column(UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    year = Column(Integer, nullable=False)
    month = Column(Integer, nullable=False)
    total_income = Column(Numeric(12, 2), nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    __table_args__ = (
        CheckConstraint("month >= 1 AND month <= 12", name="ck_budget_month_month"),
        __import__('sqlalchemy').UniqueConstraint("user_id", "year", "month", name="uq_budget_month_user_ym"),
    )
    groups = relationship("BudgetGroup", back_populates="budget_month", cascade="all, delete-orphan", order_by="BudgetGroup.sort_order")


class BudgetGroup(Base):
    __tablename__ = "budget_groups"
    id = Column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    budget_month_id = Column(UUID(as_uuid=False), ForeignKey("budget_months.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(100), nullable=False)
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    budget_month = relationship("BudgetMonth", back_populates="groups")
    categories = relationship("BudgetCategory", back_populates="group", cascade="all, delete-orphan", order_by="BudgetCategory.sort_order")


class BudgetCategory(Base):
    __tablename__ = "budget_categories"
    id = Column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    user_id = Column(UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    group_id = Column(UUID(as_uuid=False), ForeignKey("budget_groups.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(100), nullable=False)
    budgeted = Column(Numeric(12, 2), nullable=False, default=0)
    sort_order = Column(Integer, nullable=False, default=0)
    plaid_categories = Column(JSONB, nullable=False, default=list)
    cost_type = Column(String(10), nullable=False, default="variable")  # fixed / variable
    # Set when this category was auto-created to track a debt's minimum
    # payment, so it doesn't get duplicated on every sync.
    debt_account_id = Column(UUID(as_uuid=False), ForeignKey("debt_accounts.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    __table_args__ = (
        CheckConstraint("cost_type IN ('fixed','variable')", name="ck_budget_category_cost_type"),
    )
    group = relationship("BudgetGroup", back_populates="categories")
    transactions = relationship("Transaction", back_populates="budget_category")


class DebtAccount(Base):
    __tablename__ = "debt_accounts"
    id = Column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    user_id = Column(UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(150), nullable=False)
    balance = Column(Numeric(12, 2), nullable=False)
    original_balance = Column(Numeric(12, 2), nullable=True)  # user-entered; falls back to balance + payments if unset
    minimum_payment = Column(Numeric(12, 2), nullable=False, default=0)
    interest_rate = Column(Numeric(6, 4), nullable=False, default=0)
    account_type = Column(String(30), nullable=False, default="loan")  # credit_card / loan / student_loan / auto_loan / personal_loan / bnpl / other
    # User-entered fallback for credit utilization when Plaid doesn't report a
    # limit for this card (varies by issuer) — the synced BankAccount's
    # credit_limit takes priority over this when both are present.
    credit_limit = Column(Numeric(12, 2), nullable=True)
    due_date_day = Column(Integer, nullable=True)  # day of month payment is due (1-31)
    statement_date_day = Column(Integer, nullable=True)  # credit cards only: statement/reporting day (1-31)
    # Installment tracking — mainly for BNPL plans (Affirm/Klarna/Afterpay-style),
    # where progress is naturally "2 of 4 payments" rather than an open-ended balance.
    total_installments = Column(Integer, nullable=True)
    installments_paid = Column(Integer, nullable=False, default=0)
    sort_order = Column(Integer, nullable=False, default=0)
    is_paid_off = Column(Boolean, nullable=False, default=False)
    # Set when this debt was auto-created from a synced Plaid credit/loan account,
    # so its balance can be kept in sync and it won't be re-created if deleted.
    bank_account_id = Column(UUID(as_uuid=False), ForeignKey("bank_accounts.id", ondelete="SET NULL"), nullable=True, unique=True)
    dismissed = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    __table_args__ = (
        CheckConstraint("due_date_day IS NULL OR (due_date_day >= 1 AND due_date_day <= 31)", name="ck_debt_due_date_day"),
        CheckConstraint("statement_date_day IS NULL OR (statement_date_day >= 1 AND statement_date_day <= 31)", name="ck_debt_statement_date_day"),
    )
    payments = relationship("DebtPayment", back_populates="debt", cascade="all, delete-orphan", order_by="DebtPayment.paid_on.desc()")


class DebtPayment(Base):
    __tablename__ = "debt_payments"
    id = Column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    debt_id = Column(UUID(as_uuid=False), ForeignKey("debt_accounts.id", ondelete="CASCADE"), nullable=False)
    amount = Column(Numeric(12, 2), nullable=False)
    paid_on = Column(Date, nullable=False)
    note = Column(String(250))
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    debt = relationship("DebtAccount", back_populates="payments")


class SavingsGoal(Base):
    __tablename__ = "savings_goals"
    id = Column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    user_id = Column(UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(150), nullable=False)
    target_amount = Column(Numeric(12, 2), nullable=False)
    current_amount = Column(Numeric(12, 2), nullable=False, default=0)
    target_date = Column(Date, nullable=True)
    icon = Column(String(50), nullable=False, default="🎯")
    color = Column(String(20), nullable=False, default="emerald")
    sort_order = Column(Integer, nullable=False, default=0)
    is_completed = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    contributions = relationship("SavingsContribution", back_populates="goal", cascade="all, delete-orphan", order_by="SavingsContribution.contributed_on.desc()")


class SavingsContribution(Base):
    __tablename__ = "savings_contributions"
    id = Column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    goal_id = Column(UUID(as_uuid=False), ForeignKey("savings_goals.id", ondelete="CASCADE"), nullable=False)
    amount = Column(Numeric(12, 2), nullable=False)
    contributed_on = Column(Date, nullable=False)
    note = Column(String(250))
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    goal = relationship("SavingsGoal", back_populates="contributions")


class UserSubscription(Base):
    __tablename__ = "user_subscriptions"
    id = Column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    user_id = Column(UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    merchant_name = Column(String(300), nullable=False)
    status = Column(String(20), nullable=False, default="active")  # active / paused / cancelled
    notes = Column(String(500))
    # Manually-added subscriptions (not derived from detected transaction patterns).
    is_manual = Column(Boolean, nullable=False, default=False)
    # When true, this subscription (manual or detected) is hidden from the list.
    hidden = Column(Boolean, nullable=False, default=False)
    amount = Column(Numeric(12, 2), nullable=True)
    cadence = Column(String(20), nullable=True)  # weekly / biweekly / monthly / quarterly / annual
    next_expected = Column(Date, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    __table_args__ = (
        __import__('sqlalchemy').UniqueConstraint("user_id", "merchant_name", name="uq_user_subscription_user_merchant"),
    )


class BillPayment(Base):
    """Tracks whether a recurring bill was paid in a given month."""
    __tablename__ = "bill_payments"
    id = Column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    user_id = Column(UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    merchant_name = Column(String(300), nullable=False)
    year = Column(Integer, nullable=False)
    month = Column(Integer, nullable=False)
    paid = Column(Boolean, nullable=False, default=True)
    paid_on = Column(Date, nullable=True)
    notes = Column(String(500))
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    __table_args__ = (
        CheckConstraint("month >= 1 AND month <= 12", name="bill_payments_month_check"),
        __import__('sqlalchemy').UniqueConstraint("user_id", "merchant_name", "year", "month", name="uq_bill_payment_user_merchant_month"),
    )


class Paycheck(Base):
    """A recurring income schedule (e.g. biweekly paycheck from an employer)."""
    __tablename__ = "paychecks"
    id = Column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    user_id = Column(UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    source = Column(String(150), nullable=False)
    amount = Column(Numeric(12, 2), nullable=False)
    frequency = Column(String(20), nullable=False, default="biweekly")  # weekly / biweekly / semimonthly / monthly
    next_date = Column(Date, nullable=False)
    active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    __table_args__ = (
        CheckConstraint("frequency IN ('weekly','biweekly','semimonthly','monthly')", name="ck_paycheck_frequency"),
    )


class PaycheckOccurrenceOverride(Base):
    """Per-occurrence edit (amount/name) for a generated paycheck occurrence."""
    __tablename__ = "paycheck_occurrence_overrides"
    id = Column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    paycheck_id = Column(UUID(as_uuid=False), ForeignKey("paychecks.id", ondelete="CASCADE"), nullable=False)
    occurrence_date = Column(Date, nullable=False)
    source = Column(String(150), nullable=True)
    amount = Column(Numeric(12, 2), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    __table_args__ = (
        __import__('sqlalchemy').UniqueConstraint("paycheck_id", "occurrence_date", name="uq_paycheck_occurrence_override"),
    )


class NetWorthSnapshot(Base):
    __tablename__ = "net_worth_snapshots"
    id = Column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    user_id = Column(UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    year = Column(Integer, nullable=False)
    month = Column(Integer, nullable=False)
    assets = Column(Numeric(14, 2), nullable=False, default=0)
    liabilities = Column(Numeric(14, 2), nullable=False, default=0)
    net_worth = Column(Numeric(14, 2), nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    __table_args__ = (
        __import__('sqlalchemy').UniqueConstraint("user_id", "year", "month", name="uq_net_worth_snapshot_user_ym"),
    )


class AppState(Base):
    """Small key-value store for app-level state that must survive restarts
    (e.g. when the weekly digest was last sent)."""
    __tablename__ = "app_state"
    key = Column(String(100), primary_key=True)
    value = Column(String(500), nullable=False)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)


class SpendingAlert(Base):
    __tablename__ = "spending_alerts"
    id = Column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    user_id = Column(UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    category_id = Column(UUID(as_uuid=False), ForeignKey("budget_categories.id", ondelete="CASCADE"), nullable=False, unique=True)
    threshold_pct = Column(Integer, nullable=False, default=80)
    enabled = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
