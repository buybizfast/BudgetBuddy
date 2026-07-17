"""SQLAlchemy TypeDecorator that transparently encrypts/decrypts string columns.

Uses Fernet symmetric encryption when TOKEN_ENCRYPTION_KEY is set in the
environment. Falls back to plaintext when the key is absent so development
environments without the env var still work without migration.
"""
from __future__ import annotations

from sqlalchemy import String
from sqlalchemy.types import TypeDecorator

from backend.config import TOKEN_ENCRYPTION_KEY

_fernet = None
if TOKEN_ENCRYPTION_KEY:
    try:
        from cryptography.fernet import Fernet
        _fernet = Fernet(TOKEN_ENCRYPTION_KEY.encode())
    except Exception as exc:
        import logging
        logging.getLogger(__name__).warning("TOKEN_ENCRYPTION_KEY is set but invalid: %s", exc)


class EncryptedString(TypeDecorator):
    """Stores encrypted text; decrypts transparently on load."""
    impl = String
    cache_ok = True

    def process_bind_param(self, value: str | None, dialect) -> str | None:
        if value is None:
            return None
        if _fernet:
            return _fernet.encrypt(value.encode()).decode()
        return value

    def process_result_value(self, value: str | None, dialect) -> str | None:
        if value is None:
            return None
        if _fernet:
            try:
                return _fernet.decrypt(value.encode()).decode()
            except Exception:
                # Value was stored before encryption was enabled — return as-is.
                return value
        return value
