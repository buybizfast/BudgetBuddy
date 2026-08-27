"""Auth routes — signup, login, password reset."""
from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, field_validator
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.auth import (
    authenticate_user, consume_reset_token, create_reset_token,
    create_token, create_user, get_current_user,
)
from backend.config import OWNER_EMAIL, SIGNUP_INVITE_CODE
from backend.db.base import get_session
from backend.db.models import User
from backend.services.email_service import send_password_reset_email, send_welcome_email

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])
_limiter = Limiter(key_func=get_remote_address)

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class SignupRequest(BaseModel):
    email: str
    password: str
    invite_code: str | None = None

    @field_validator("email")
    @classmethod
    def valid_email(cls, v: str) -> str:
        v = v.strip().lower()
        if not _EMAIL_RE.match(v):
            raise ValueError("Enter a valid email address")
        return v

    @field_validator("password")
    @classmethod
    def valid_password(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v


class LoginRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


@router.get("/config")
async def auth_config():
    """Public signup requirements, so the form can label the invite-code field
    accurately instead of guessing whether this deployment gates signup."""
    return {"invite_required": bool(SIGNUP_INVITE_CODE)}


@router.post("/signup", response_model=TokenResponse)
@_limiter.limit("5/minute")
async def signup(request: Request, body: SignupRequest, db: AsyncSession = Depends(get_session)):
    # An invite code, when configured, keeps signup closed to people you've
    # shared it with — otherwise the app is open to anyone with the URL.
    if SIGNUP_INVITE_CODE and (body.invite_code or "").strip() != SIGNUP_INVITE_CODE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="That invite code isn't valid")

    result = await db.execute(select(User).where(User.email == body.email))
    if result.scalar_one_or_none() is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="An account with that email already exists")

    from api.main import claim_legacy_data, has_unclaimed_data

    # Decide before creating the account, so the check isn't confused by the
    # new user's own (empty) rows.
    should_claim = False
    try:
        if await has_unclaimed_data(db):
            if OWNER_EMAIL:
                should_claim = body.email == OWNER_EMAIL.strip().lower()
            else:
                # No owner nominated — the first account to exist takes it.
                existing = await db.execute(select(User).limit(1))
                should_claim = existing.scalar_one_or_none() is None
    except Exception:
        should_claim = False

    user = await create_user(db, body.email, body.password)

    if should_claim:
        try:
            await claim_legacy_data(user.id, db)
        except Exception:
            pass  # account still works; data can be claimed on a later attempt

    try:
        send_welcome_email(user.email)
    except Exception:
        pass  # never block signup on a welcome-email hiccup
    return TokenResponse(access_token=create_token(user.id))


@router.post("/login", response_model=TokenResponse)
@_limiter.limit("10/minute")
async def login(request: Request, body: LoginRequest, db: AsyncSession = Depends(get_session)):
    user = await authenticate_user(db, body.email, body.password)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    return TokenResponse(access_token=create_token(user.id))


class ForgotPasswordRequest(BaseModel):
    email: str


@router.post("/forgot-password")
@_limiter.limit("5/minute")
async def forgot_password(request: Request, body: ForgotPasswordRequest, db: AsyncSession = Depends(get_session)):
    """Always returns 200 with the same message regardless of whether the
    email exists — don't leak which addresses have accounts."""
    result = await db.execute(select(User).where(User.email == body.email.strip().lower()))
    user = result.scalar_one_or_none()
    if user:
        raw_token = await create_reset_token(db, user)
        try:
            send_password_reset_email(user.email, raw_token)
        except Exception:
            pass
    return {"status": "ok", "message": "If that email has an account, a reset link is on its way."}


class ResetPasswordRequest(BaseModel):
    token: str
    password: str

    @field_validator("password")
    @classmethod
    def valid_password(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v


@router.post("/reset-password")
@_limiter.limit("10/minute")
async def reset_password(request: Request, body: ResetPasswordRequest, db: AsyncSession = Depends(get_session)):
    ok = await consume_reset_token(db, body.token, body.password)
    if not ok:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This reset link is invalid or has expired")
    return {"status": "ok"}


@router.get("/me")
async def me(user_id: str = Depends(get_current_user), db: AsyncSession = Depends(get_session)):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one()
    return {"id": user.id, "email": user.email}
