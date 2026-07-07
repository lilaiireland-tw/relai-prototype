from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import UserAccount
from app.models.enums import AuthProvider


class UserRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_by_id(self, user_id: str) -> UserAccount | None:
        statement = select(UserAccount).where(UserAccount.id == user_id)
        return self.db.scalar(statement)

    def get_or_create_local_user(self, user_id: str) -> UserAccount:
        user = self.get_by_id(user_id)
        if user is not None:
            return user

        user = UserAccount(
            id=user_id,
            email=f"{user_id}@local.relai.dev",
            display_name="Local Developer",
            auth_provider=AuthProvider.EMAIL,
            onboarding_completed=True,
        )
        self.db.add(user)
        self.db.flush()
        self.db.refresh(user)
        return user
