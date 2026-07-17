"""Auth routes — login and token refresh."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from slowapi import Limiter
from slowapi.util import get_remote_address

from api.auth import authenticate, create_token, get_current_user

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])
_limiter = Limiter(key_func=get_remote_address)


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


@router.post("/login", response_model=TokenResponse)
@_limiter.limit("10/minute")
async def login(request: Request, body: LoginRequest):
    if not authenticate(body.username, body.password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    return TokenResponse(access_token=create_token(body.username))


@router.get("/me")
async def me(username: str = Depends(get_current_user)):
    return {"username": username}
