from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel

from app.models.enums import CohortSource
from app.schemas.common import ORMModel


class UserStatsResponse(ORMModel):
    user_id: UUID
    streak_days: int
    last_active_date: date | None
    total_cards_created: int
    total_reviews: int
    badges_unlocked: list[str]
    cohort_source: CohortSource
    updated_at: datetime
