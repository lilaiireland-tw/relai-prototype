from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models import ReviewEvent
from app.models.enums import ReviewRating
from app.repositories.flashcard_repository import FlashcardRepository
from app.repositories.review_repository import ReviewRepository
from app.repositories.stats_repository import StatsRepository
from app.repositories.user_repository import UserRepository


class ReviewService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.users = UserRepository(db)
        self.flashcards = FlashcardRepository(db)
        self.reviews = ReviewRepository(db)
        self.stats = StatsRepository(db)

    def submit_review(self, user_id: str, flashcard_id: str, rating: ReviewRating) -> tuple[ReviewEvent, int, int]:
        self.users.get_or_create_local_user(user_id)
        flashcard = self.flashcards.get_for_user(flashcard_id=flashcard_id, user_id=user_id)
        if flashcard is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Flashcard not found")

        now = datetime.now(UTC)
        review = ReviewEvent(
            user_id=user_id,
            flashcard_id=flashcard_id,
            rating=rating,
            reviewed_at=now,
            due_before_review=flashcard.next_review_at,
            next_review_at=None,
        )
        saved_review = self.reviews.create(review)

        flashcard.last_reviewed_at = now
        flashcard.next_review_at = None

        stats = self.stats.get_or_create(user_id)
        stats.total_reviews += 1
        today = now.date()
        if stats.last_active_date != today:
            if stats.last_active_date is not None and (today - stats.last_active_date).days == 1:
                stats.streak_days += 1
            else:
                stats.streak_days = 1
            stats.last_active_date = today

        self.db.commit()
        self.db.refresh(saved_review)
        self.db.refresh(stats)
        return saved_review, stats.total_reviews, stats.streak_days


class StatsService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.users = UserRepository(db)
        self.stats = StatsRepository(db)

    def get_user_stats(self, user_id: str):
        self.users.get_or_create_local_user(user_id)
        return self.stats.get_or_create(user_id)
