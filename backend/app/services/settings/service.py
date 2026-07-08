from sqlalchemy.orm import Session

from app.repositories.settings_repository import SettingsRepository
from app.repositories.user_repository import UserRepository
from app.schemas.settings import UserSettingsUpdateRequest


class SettingsService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.users = UserRepository(db)
        self.settings = SettingsRepository(db)

    def get_settings(self, user_id: str):
        self.users.get_required(user_id)
        return self.settings.get_or_create(user_id)

    def update_settings(self, user_id: str, payload: UserSettingsUpdateRequest):
        settings = self.get_settings(user_id)
        updates = payload.model_dump(exclude_none=True)
        for field, value in updates.items():
            setattr(settings, field, value)

        self.db.commit()
        self.db.refresh(settings)
        return settings
