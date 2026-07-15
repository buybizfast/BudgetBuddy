"""Bill payment tracking routes."""
from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, and_, delete
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db.base import get_session
from backend.db.models import BillPayment

router = APIRouter(prefix="/api/v1/bills", tags=["bills"])


@router.get("/paid")
async def get_paid_bills(year: int = Query(...), month: int = Query(...), db: AsyncSession = Depends(get_session)):
    result = await db.execute(
        select(BillPayment).where(and_(BillPayment.year == year, BillPayment.month == month))
    )
    payments = result.scalars().all()
    return [
        {
            "merchant_name": p.merchant_name,
            "paid": p.paid,
            "paid_on": p.paid_on.isoformat() if p.paid_on else None,
            "notes": p.notes,
        }
        for p in payments
    ]


class MarkPaidRequest(BaseModel):
    merchant_name: str
    year: int
    month: int
    paid_on: Optional[date] = None
    notes: Optional[str] = None


@router.post("/paid")
async def mark_paid(body: MarkPaidRequest, db: AsyncSession = Depends(get_session)):
    result = await db.execute(
        select(BillPayment).where(
            and_(
                BillPayment.merchant_name == body.merchant_name,
                BillPayment.year == body.year,
                BillPayment.month == body.month,
            )
        )
    )
    payment = result.scalar_one_or_none()
    if payment:
        payment.paid = True
        payment.paid_on = body.paid_on or date.today()
        payment.notes = body.notes
        payment.updated_at = datetime.utcnow()
    else:
        payment = BillPayment(
            merchant_name=body.merchant_name,
            year=body.year,
            month=body.month,
            paid=True,
            paid_on=body.paid_on or date.today(),
            notes=body.notes,
        )
        db.add(payment)
    await db.commit()
    return {"status": "ok"}


@router.delete("/paid")
async def mark_unpaid(merchant_name: str = Query(...), year: int = Query(...), month: int = Query(...), db: AsyncSession = Depends(get_session)):
    await db.execute(
        delete(BillPayment).where(
            and_(
                BillPayment.merchant_name == merchant_name,
                BillPayment.year == year,
                BillPayment.month == month,
            )
        )
    )
    await db.commit()
    return {"status": "ok"}
