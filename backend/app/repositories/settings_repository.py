from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import UserSetting


class SettingsRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_or_create(self, user_id: str) -> UserSetting:
        statement = select(UserSetting).where(UserSetting.user_id == user_id)
        settings = self.db.scalar(statement)
        if settings is not None:
            return settings

        settings = UserSetting(user_id=user_id)
        self.db.add(settings)
        self.db.flush()
        self.db.refresh(settings)
        return settings
