from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

from app.models.enums import ReviewRating
from app.schemas.common import ORMModel


class ReviewSubmitRequest(BaseModel):
    flashcard_id: UUID
    rating: ReviewRating


class ReviewEventResponse(ORMModel):
    id: UUID
    user_id: UUID
    flashcard_id: UUID
    rating: ReviewRating
    reviewed_at: datetime
    due_before_review: datetime | None
    next_review_at: datetime | None


class ReviewSubmitResponse(BaseModel):
    review: ReviewEventResponse
    total_reviews: int
    streak_days: int
