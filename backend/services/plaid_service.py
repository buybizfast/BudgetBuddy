"""Plaid integration: link tokens, token exchange, transaction sync."""
from __future__ import annotations

import logging
import uuid
from datetime import date, timedelta
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from backend.config import PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV, PLAID_REDIRECT_URI
from backend.db.models import PlaidItem, BankAccount, Transaction

log = logging.getLogger("services.plaid")

try:
    import plaid
    from plaid.api import plaid_api
    from plaid.model.country_code import CountryCode
    from plaid.model.link_token_create_request import LinkTokenCreateRequest
    from plaid.model.link_token_create_request_user import LinkTokenCreateRequestUser
    from plaid.model.item_public_token_exchange_request import ItemPublicTokenExchangeRequest
    from plaid.model.transactions_sync_request import TransactionsSyncRequest
    from plaid.model.products import Products
    _PLAID_AVAILABLE = True
    _ENV_MAP = {
        "sandbox": plaid.Environment.Sandbox,
        # Plaid retired the standalone "development" environment; it now
        # shares the sandbox host, so route it there for compatibility.
        "development": plaid.Environment.Sandbox,
        "production": plaid.Environment.Production,
    }
except ImportError:
    _PLAID_AVAILABLE = False
    _ENV_MAP = {}
    log.warning("plaid-python not installed — bank sync disabled.")


def _get_client():
    if not _PLAID_AVAILABLE:
        raise RuntimeError("plaid-python is not installed. Run: pip install plaid-python")
    configuration = plaid.Configuration(
        host=_ENV_MAP.get(PLAID_ENV, plaid.Environment.Sandbox),
        api_key={"clientId": PLAID_CLIENT_ID, "secret": PLAID_SECRET},
    )
    return plaid_api.PlaidApi(plaid.ApiClient(configuration))


async def create_link_token(user_id: str = "default-user") -> str:
    client = _get_client()
    kwargs: dict[str, Any] = dict(
        products=[Products("transactions")],
        client_name="Budget Buddy",
        country_codes=[CountryCode("US")],
        language="en",
        user=LinkTokenCreateRequestUser(client_user_id=user_id),
    )
    if PLAID_REDIRECT_URI:
        kwargs["redirect_uri"] = PLAID_REDIRECT_URI
    request = LinkTokenCreateRequest(**kwargs)
    response = client.link_token_create(request)
    log.info("Created Plaid link token — request_id=%s", response.get("request_id"))
    return response["link_token"]


async def exchange_public_token(public_token: str, db: AsyncSession) -> dict[str, Any]:
    client = _get_client()
    exchange_response = client.item_public_token_exchange(
        ItemPublicTokenExchangeRequest(public_token=public_token)
    )
    access_token = exchange_response["access_token"]
    item_id = exchange_response["item_id"]

    from plaid.model.item_get_request import ItemGetRequest
    from plaid.model.institutions_get_by_id_request import InstitutionsGetByIdRequest

    item_response = client.item_get(ItemGetRequest(access_token=access_token))
    institution_id = item_response["item"]["institution_id"]
    institution_name = institution_id
    try:
        inst_response = client.institutions_get_by_id(
            InstitutionsGetByIdRequest(institution_id=institution_id, country_codes=[CountryCode("US")])
        )
        institution_name = inst_response["institution"]["name"]
    except Exception:
        pass

    result = await db.execute(select(PlaidItem).where(PlaidItem.item_id == item_id))
    existing = result.scalar_one_or_none()
    if existing:
        existing.access_token = access_token
        existing.institution_name = institution_name
        plaid_item = existing
    else:
        plaid_item = PlaidItem(item_id=item_id, access_token=access_token,
                               institution_id=institution_id, institution_name=institution_name)
        db.add(plaid_item)

    await db.flush()
    await _sync_accounts(client, plaid_item, db)
    await db.commit()
    return {"item_id": str(plaid_item.id), "institution_name": institution_name}


def _plaid_str(v: Any, default: str | None = None) -> str | None:
    """Plaid's generated SDK models sometimes wrap enum-like fields (account
    type/subtype) in small model objects rather than plain strings — prefer
    `.value` when present instead of trusting str(x) to equal the raw API
    value, so type comparisons like `== "credit"` don't silently fail."""
    if v is None:
        return default
    return str(getattr(v, "value", v))


async def _sync_accounts(client, plaid_item: PlaidItem, db: AsyncSession) -> None:
    from plaid.model.accounts_get_request import AccountsGetRequest
    from backend.services.debt_service import sync_debt_from_plaid_account
    response = client.accounts_get(AccountsGetRequest(access_token=plaid_item.access_token))
    for acct in response["accounts"]:
        result = await db.execute(select(BankAccount).where(BankAccount.account_id == acct["account_id"]))
        existing = result.scalar_one_or_none()
        balances = acct.get("balances", {})
        current_bal = float(balances.get("current") or 0)
        available_bal = balances.get("available")
        if available_bal is not None:
            available_bal = float(available_bal)
        acct_type = _plaid_str(acct.get("type"), "depository")
        acct_subtype = _plaid_str(acct.get("subtype"))
        acct_name = acct.get("name", "Account")
        if existing:
            existing.current_balance = current_bal
            existing.available_balance = available_bal
            existing.name = acct.get("name", existing.name)
            existing.type = acct_type
            existing.subtype = acct_subtype
            bank_account_id = existing.id
        else:
            bank_account_id = str(uuid.uuid4())
            db.add(BankAccount(
                id=bank_account_id,
                plaid_item_id=plaid_item.id, account_id=acct["account_id"],
                name=acct_name, official_name=acct.get("official_name"),
                type=acct_type, subtype=acct_subtype,
                current_balance=current_bal, available_balance=available_bal, mask=acct.get("mask"),
                institution_name=plaid_item.institution_name,
            ))
        log.info("Plaid account synced: name=%r type=%r subtype=%r balance=%s bank_account_id=%s",
                 acct_name, acct_type, acct_subtype, current_bal, bank_account_id)
        # Credit cards and loans double as liabilities — keep a matching
        # DebtAccount in sync automatically instead of requiring manual entry.
        await sync_debt_from_plaid_account(bank_account_id, acct_name, current_bal, acct_type, acct_subtype, db)


async def sync_transactions(item_id: str, db: AsyncSession) -> dict[str, Any]:
    from backend.services.auto_categorizer import auto_assign
    result = await db.execute(select(PlaidItem).where(PlaidItem.id == item_id))
    plaid_item = result.scalar_one_or_none()
    if not plaid_item:
        raise ValueError(f"PlaidItem {item_id} not found")
    client = _get_client()
    cursor = plaid_item.cursor
    added_count = 0
    new_txn_summaries: list[dict] = []
    has_more = True
    while has_more:
        req_kwargs: dict[str, Any] = {"access_token": plaid_item.access_token}
        if cursor:
            req_kwargs["cursor"] = cursor
        resp = client.transactions_sync(TransactionsSyncRequest(**req_kwargs))
        for txn in resp["added"]:
            new_obj = await _upsert_transaction(txn, db)
            if new_obj:
                await auto_assign(new_obj, db)
                new_txn_summaries.append({"name": new_obj.name, "merchant_name": new_obj.merchant_name,
                                          "amount": float(new_obj.amount), "date": new_obj.date.isoformat() if new_obj.date else None,
                                          "auto_categorized": new_obj.budget_category_id is not None})
                added_count += 1
        for txn in resp["modified"]:
            await _upsert_transaction(txn, db)
        for removed in resp["removed"]:
            result = await db.execute(select(Transaction).where(Transaction.plaid_transaction_id == removed["transaction_id"]))
            txn_obj = result.scalar_one_or_none()
            if txn_obj:
                await db.delete(txn_obj)
        cursor = resp["next_cursor"]
        has_more = resp["has_more"]
    plaid_item.cursor = cursor
    await _sync_accounts(client, plaid_item, db)
    await db.commit()
    return {"added": added_count, "new_transactions": new_txn_summaries}


async def _upsert_transaction(txn: Any, db: AsyncSession) -> Transaction | None:
    result = await db.execute(select(BankAccount).where(BankAccount.account_id == txn["account_id"]))
    bank_acct = result.scalar_one_or_none()
    if not bank_acct:
        return None
    result = await db.execute(select(Transaction).where(Transaction.plaid_transaction_id == txn["transaction_id"]))
    existing = result.scalar_one_or_none()
    pfc_raw = txn.get("personal_finance_category") or {}
    pfc = pfc_raw.get("detailed") or pfc_raw.get("primary") if pfc_raw else None
    categories = txn.get("category") or []
    txn_date = txn.get("date")
    if isinstance(txn_date, str):
        from datetime import datetime
        txn_date = datetime.strptime(txn_date, "%Y-%m-%d").date()
    if existing:
        existing.amount = float(txn.get("amount", 0))
        existing.date = txn_date
        existing.name = txn.get("name", "")
        existing.merchant_name = txn.get("merchant_name")
        existing.category = categories[0] if categories else None
        existing.pending = bool(txn.get("pending", False))
        existing.personal_finance_category = pfc
        return None
    else:
        new_txn = Transaction(
            account_id=bank_acct.id, plaid_transaction_id=txn["transaction_id"],
            amount=float(txn.get("amount", 0)), date=txn_date, name=txn.get("name", ""),
            merchant_name=txn.get("merchant_name"), category=categories[0] if categories else None,
            category_id=txn.get("category_id"), pending=bool(txn.get("pending", False)),
            payment_channel=txn.get("payment_channel"), logo_url=txn.get("logo_url"),
            personal_finance_category=pfc, meta=dict(txn) if isinstance(txn, dict) else {},
        )
        db.add(new_txn)
        await db.flush()
        return new_txn


async def refresh_all_items(db: AsyncSession) -> dict[str, Any]:
    from sqlalchemy import update as sa_update
    result = await db.execute(select(PlaidItem).where(PlaidItem.status == "active"))
    # Capture plain ids up front — db.rollback() (used below on a per-item
    # failure) expires every loaded ORM object, and re-touching an expired
    # attribute on an AsyncSession triggers an implicit lazy-load that isn't
    # supported outside a greenlet context and crashes the whole request.
    item_ids = [str(i.id) for i in result.scalars().all()]
    total_added = 0
    all_new_txns: list[dict] = []
    for item_id in item_ids:
        try:
            summary = await sync_transactions(item_id, db)
            total_added += summary["added"]
            all_new_txns.extend(summary["new_transactions"])
            await db.execute(
                sa_update(PlaidItem).where(PlaidItem.id == item_id, PlaidItem.last_sync_error.isnot(None))
                .values(last_sync_error=None)
            )
            await db.commit()
        except Exception as exc:
            log.error("Failed to sync item %s: %s", item_id, exc)
            # A failed query leaves the shared session's transaction aborted —
            # without rolling back here, every subsequent item in this loop
            # would fail too ("current transaction is aborted"), even if its
            # own sync would otherwise have succeeded.
            await db.rollback()
            try:
                await db.execute(
                    sa_update(PlaidItem).where(PlaidItem.id == item_id).values(last_sync_error=str(exc)[:500])
                )
                await db.commit()
            except Exception as record_exc:
                log.error("Failed to record sync error for item %s: %s", item_id, record_exc)
                await db.rollback()
    return {"total_added": total_added, "new_transactions": all_new_txns}
