from datetime import datetime

from pydantic import BaseModel

from app.models.enums import ReviewRating
from app.schemas.common import ORMModel


class ReviewSubmitRequest(BaseModel):
    flashcard_id: str
    rating: ReviewRating


class ReviewEventResponse(ORMModel):
    id: str
    user_id: str
    flashcard_id: str
    rating: ReviewRating
    reviewed_at: datetime
    due_before_review: datetime | None
    next_review_at: datetime | None


class ReviewSubmitResponse(BaseModel):
    review: ReviewEventResponse
    total_reviews: int
    streak_days: int
