"""Weekly digest email routes: preview in the browser, send on demand."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.auth import get_current_user
from backend.config import RESEND_API_KEY
from backend.db.base import get_session
from backend.db.models import User
from backend.services.digest_service import build_digest, send_weekly_digest

router = APIRouter(prefix="/api/v1/digest", tags=["digest"])


@router.get("/preview", response_class=HTMLResponse)
async def preview_digest(user_id: str = Depends(get_current_user), db: AsyncSession = Depends(get_session)):
    _, html = await build_digest(user_id, db)
    return HTMLResponse(html)


@router.post("/send")
async def send_digest_now(user_id: str = Depends(get_current_user), db: AsyncSession = Depends(get_session)):
    if not RESEND_API_KEY:
        raise HTTPException(status_code=503, detail="RESEND_API_KEY is not set — add it in Railway to enable digest emails.")
    sent = await send_weekly_digest(user_id, db)
    if not sent:
        raise HTTPException(status_code=502, detail="Digest send failed — check server logs.")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    return {"status": "sent", "to": user.email if user else None}
