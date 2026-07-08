from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel


class UserSettingsResponse(ORMModel):
    user_id: UUID
    interface_language: str
    timezone: str
    daily_review_goal: int
    review_reminder_enabled: bool


class UserSettingsUpdateRequest(BaseModel):
    interface_language: str | None = Field(default=None, min_length=2, max_length=16)
    timezone: str | None = Field(default=None, min_length=2, max_length=64)
    daily_review_goal: int | None = Field(default=None, ge=1, le=500)
    review_reminder_enabled: bool | None = None
