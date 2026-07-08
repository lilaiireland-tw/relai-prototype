from datetime import date, datetime
from uuid import UUID

from app.models.enums import AuthProvider, CohortSource
from app.schemas.common import ORMModel
from app.schemas.settings import UserSettingsResponse


class UserProfileResponse(ORMModel):
    id: UUID
    email: str
    display_name: str | None
    auth_provider: AuthProvider
    provider_subject: str | None
    avatar_url: str | None
    is_active: bool
    onboarding_completed: bool
    last_login_at: datetime | None
    created_at: datetime
    updated_at: datetime


class UserStatsSnapshotResponse(ORMModel):
    user_id: UUID
    streak_days: int
    last_active_date: date | None
    total_cards_created: int
    total_reviews: int
    badges_unlocked: list[str]
    cohort_source: CohortSource
    updated_at: datetime


class AuthBootstrapResponse(ORMModel):
    profile: UserProfileResponse
    settings: UserSettingsResponse
    stats: UserStatsSnapshotResponse
