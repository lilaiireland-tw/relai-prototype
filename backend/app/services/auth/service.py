from sqlalchemy.orm import Session

from app.repositories.user_repository import UserRepository


class LocalAuthService:
    def __init__(self, db: Session) -> None:
        self.users = UserRepository(db)

    def ensure_user(self, user_id: str) -> None:
        self.users.get_or_create_local_user(user_id)
