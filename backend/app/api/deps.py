from collections.abc import Generator

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.security import decode_token
from app.core.database import SessionLocal
from app.repositories.user_repository import UserRepository
from app.schemas.user import CurrentUser


oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/token")


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_bearer_token(token: str = Depends(oauth2_scheme)) -> str:
    return token


def get_current_user(
    token: str = Depends(get_bearer_token),
    db: Session = Depends(get_db),
) -> CurrentUser:
    payload = decode_token(token)
    subject = payload.get("sub")
    jti = payload.get("jti")
    if not isinstance(subject, str) or not isinstance(jti, str):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
            headers={"WWW-Authenticate": "Bearer"},
        )

    users = UserRepository(db)
    if users.is_token_revoked(jti):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has been revoked",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = users.get_by_id(subject)
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return CurrentUser(user_id=user.id, email=user.email)
