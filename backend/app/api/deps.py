from collections.abc import Generator
from uuid import UUID

from fastapi import Header
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.schemas.user import CurrentUser


DEFAULT_LOCAL_USER_ID = UUID("00000000-0000-0000-0000-000000000001")


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user(x_user_id: UUID | None = Header(default=None)) -> CurrentUser:
    return CurrentUser(user_id=x_user_id or DEFAULT_LOCAL_USER_ID)
