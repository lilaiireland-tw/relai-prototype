from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.schemas.review import ReviewEventResponse, ReviewSubmitRequest, ReviewSubmitResponse
from app.schemas.user import CurrentUser
from app.services.stats.service import ReviewService

router = APIRouter(prefix="/reviews", tags=["reviews"])


@router.post("", response_model=ReviewSubmitResponse, status_code=201)
def submit_review(
    payload: ReviewSubmitRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
) -> ReviewSubmitResponse:
    service = ReviewService(db)
    review, total_reviews, streak_days = service.submit_review(
        user_id=current_user.user_id,
        flashcard_id=payload.flashcard_id,
        rating=payload.rating,
    )
    return ReviewSubmitResponse(
        review=ReviewEventResponse.model_validate(review),
        total_reviews=total_reviews,
        streak_days=streak_days,
    )
