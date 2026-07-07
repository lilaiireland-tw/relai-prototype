from collections.abc import Generator

from fastapi import Header
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.schemas.user import CurrentUser


DEFAULT_LOCAL_USER_ID = "00000000-0000-0000-0000-000000000001"


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user(x_user_id: str | None = Header(default=None)) -> CurrentUser:
    return CurrentUser(user_id=x_user_id or DEFAULT_LOCAL_USER_ID)
