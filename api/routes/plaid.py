"""Plaid routes."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from backend.db.base import get_session
from backend.db.models import PlaidItem, BankAccount
from backend.services import plaid_service

router = APIRouter(prefix="/api/v1/plaid", tags=["plaid"])


@router.get("/link-token")
async def get_link_token():
    try:
        token = await plaid_service.create_link_token()
        return {"link_token": token}
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc))


class ExchangeTokenRequest(BaseModel):
    public_token: str

@router.post("/exchange-token")
async def exchange_token(body: ExchangeTokenRequest, db: AsyncSession = Depends(get_session)):
    try:
        return await plaid_service.exchange_public_token(body.public_token, db)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@router.post("/sync/{item_id}")
async def sync_item(item_id: str, db: AsyncSession = Depends(get_session)):
    from api.ws_manager import ws_manager
    summary = await plaid_service.sync_transactions(item_id, db)
    if summary["added"] > 0:
        await ws_manager.broadcast_budget_update(summary["added"], summary["new_transactions"])
    return summary


@router.post("/sync-all")
async def sync_all(db: AsyncSession = Depends(get_session)):
    from api.ws_manager import ws_manager
    summary = await plaid_service.refresh_all_items(db)
    if summary["total_added"] > 0:
        await ws_manager.broadcast_budget_update(summary["total_added"], summary["new_transactions"])
    return summary


@router.get("/accounts")
async def list_accounts(db: AsyncSession = Depends(get_session)):
    result = await db.execute(select(BankAccount).where(BankAccount.is_active == True).order_by(BankAccount.created_at))
    accounts = result.scalars().all()
    return [{"id": str(a.id), "account_id": a.account_id, "name": a.name, "official_name": a.official_name,
             "type": a.type, "subtype": a.subtype, "current_balance": float(a.current_balance),
             "available_balance": float(a.available_balance) if a.available_balance is not None else None,
             "mask": a.mask, "institution_name": a.institution_name} for a in accounts]


@router.get("/items")
async def list_items(db: AsyncSession = Depends(get_session)):
    result = await db.execute(select(PlaidItem).where(PlaidItem.status == "active"))
    items = result.scalars().all()
    return [{"id": str(i.id), "institution_name": i.institution_name, "status": i.status} for i in items]


@router.delete("/items/{item_id}")
async def remove_item(item_id: str, db: AsyncSession = Depends(get_session)):
    result = await db.execute(select(PlaidItem).where(PlaidItem.id == item_id))
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    await db.delete(item)
    await db.commit()
    return {"status": "ok"}
