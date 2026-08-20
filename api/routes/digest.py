"""Weekly digest email routes: preview in the browser, send on demand."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import DIGEST_EMAIL, RESEND_API_KEY
from backend.db.base import get_session
from backend.services.digest_service import build_digest, send_weekly_digest

router = APIRouter(prefix="/api/v1/digest", tags=["digest"])


@router.get("/preview", response_class=HTMLResponse)
async def preview_digest(db: AsyncSession = Depends(get_session)):
    _, html = await build_digest(db)
    return HTMLResponse(html)


@router.post("/send")
async def send_digest_now(db: AsyncSession = Depends(get_session)):
    if not RESEND_API_KEY:
        raise HTTPException(status_code=503, detail="RESEND_API_KEY is not set — add it in Railway to enable digest emails.")
    if not DIGEST_EMAIL:
        raise HTTPException(status_code=503, detail="DIGEST_EMAIL is not set — add your inbox address in Railway.")
    sent = await send_weekly_digest(db)
    if not sent:
        raise HTTPException(status_code=502, detail="Digest send failed — check server logs.")
    return {"status": "sent", "to": DIGEST_EMAIL}
