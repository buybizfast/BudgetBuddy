"""Plaid routes."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from api.auth import get_current_user
from backend.db.base import get_session
from backend.db.models import PlaidItem, BankAccount
from backend.services import plaid_service

router = APIRouter(prefix="/api/v1/plaid", tags=["plaid"])


@router.get("/link-token")
async def get_link_token(user_id: str = Depends(get_current_user)):
    try:
        token = await plaid_service.create_link_token(user_id)
        return {"link_token": token}
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc))


class ExchangeTokenRequest(BaseModel):
    public_token: str

@router.post("/exchange-token")
async def exchange_token(body: ExchangeTokenRequest, user_id: str = Depends(get_current_user), db: AsyncSession = Depends(get_session)):
    try:
        return await plaid_service.exchange_public_token(body.public_token, user_id, db)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@router.post("/sync/{item_id}")
async def sync_item(item_id: str, user_id: str = Depends(get_current_user), db: AsyncSession = Depends(get_session)):
    from api.ws_manager import ws_manager
    result = await db.execute(select(PlaidItem).where(PlaidItem.id == item_id, PlaidItem.user_id == user_id))
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Item not found")
    summary = await plaid_service.sync_transactions(item_id, db)
    if summary["added"] > 0:
        await ws_manager.broadcast_budget_update(summary["added"], summary["new_transactions"], user_id)
    return summary


@router.post("/sync-all")
async def sync_all(user_id: str = Depends(get_current_user), db: AsyncSession = Depends(get_session)):
    from api.ws_manager import ws_manager
    summary = await plaid_service.refresh_all_items(db, user_id)
    if summary["total_added"] > 0:
        await ws_manager.broadcast_budget_update(summary["total_added"], summary["new_transactions"], user_id)
    return summary


@router.get("/accounts")
async def list_accounts(user_id: str = Depends(get_current_user), db: AsyncSession = Depends(get_session)):
    result = await db.execute(
        select(BankAccount).where(BankAccount.user_id == user_id, BankAccount.is_active == True)
        .order_by(BankAccount.created_at)
    )
    accounts = result.scalars().all()
    return [{"id": str(a.id), "account_id": a.account_id, "name": a.name, "official_name": a.official_name,
             "type": a.type, "subtype": a.subtype, "current_balance": float(a.current_balance),
             "available_balance": float(a.available_balance) if a.available_balance is not None else None,
             "credit_limit": float(a.credit_limit) if a.credit_limit is not None else None,
             "mask": a.mask, "institution_name": a.institution_name} for a in accounts]


@router.get("/items")
async def list_items(user_id: str = Depends(get_current_user), db: AsyncSession = Depends(get_session)):
    # The "manual-<user_id>" item backs the Cash/Manual account for
    # hand-entered transactions — it's not a real Plaid connection, so it
    # shouldn't appear as one to disconnect/reconnect.
    result = await db.execute(
        select(PlaidItem).where(
            PlaidItem.user_id == user_id, PlaidItem.status == "active",
            PlaidItem.item_id != f"manual-{user_id}",
        )
    )
    items = result.scalars().all()
    return [{"id": str(i.id), "institution_name": i.institution_name, "status": i.status,
             "last_sync_error": i.last_sync_error} for i in items]


@router.delete("/items/{item_id}")
async def remove_item(item_id: str, user_id: str = Depends(get_current_user), db: AsyncSession = Depends(get_session)):
    result = await db.execute(select(PlaidItem).where(PlaidItem.id == item_id, PlaidItem.user_id == user_id))
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    if item.item_id == f"manual-{user_id}":
        raise HTTPException(status_code=400, detail="Cannot disconnect the manual cash account")
    await db.delete(item)
    await db.commit()
    return {"status": "ok"}
