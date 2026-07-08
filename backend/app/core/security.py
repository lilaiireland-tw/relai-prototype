from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from fastapi import HTTPException, status

from app.core.config import settings


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    derived_key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 100_000)
    return f"pbkdf2_sha256$100000${salt}${derived_key.hex()}"


def verify_password(password: str, password_hash: str) -> bool:
    try:
        algorithm_name, iterations_text, salt, digest = password_hash.split("$", maxsplit=3)
    except ValueError:
        return False

    if algorithm_name != "pbkdf2_sha256":
        return False

    derived_key = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        int(iterations_text),
    )
    return hmac.compare_digest(derived_key.hex(), digest)


def create_access_token(subject: str, expires_delta: timedelta | None = None) -> str:
    now = datetime.now(UTC)
    expire_at = now + (expires_delta or timedelta(minutes=settings.access_token_expire_minutes))
    header = {"alg": settings.algorithm, "typ": "JWT"}
    payload = {
        "sub": subject,
        "jti": str(uuid4()),
        "type": "access",
        "iat": int(now.timestamp()),
        "exp": int(expire_at.timestamp()),
    }

    header_segment = _b64url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    payload_segment = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signing_input = f"{header_segment}.{payload_segment}".encode("ascii")
    signature = hmac.new(settings.secret_key.encode("utf-8"), signing_input, hashlib.sha256).digest()
    return f"{header_segment}.{payload_segment}.{_b64url_encode(signature)}"


def decode_token(token: str) -> dict[str, str | int]:
    try:
        header_segment, payload_segment, signature_segment = token.split(".")
    except ValueError as exc:
        raise _credentials_error() from exc

    signing_input = f"{header_segment}.{payload_segment}".encode("ascii")
    expected_signature = hmac.new(
        settings.secret_key.encode("utf-8"),
        signing_input,
        hashlib.sha256,
    ).digest()
    if not hmac.compare_digest(_b64url_encode(expected_signature), signature_segment):
        raise _credentials_error()

    try:
        payload = json.loads(_b64url_decode(payload_segment))
    except (json.JSONDecodeError, ValueError) as exc:
        raise _credentials_error() from exc

    exp = payload.get("exp")
    sub = payload.get("sub")
    if not isinstance(exp, int) or not isinstance(sub, str):
        raise _credentials_error()
    if datetime.now(UTC).timestamp() >= exp:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return payload


def _credentials_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
