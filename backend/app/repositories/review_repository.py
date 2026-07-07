from sqlalchemy.orm import Session

from app.models import ReviewEvent


class ReviewRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def create(self, review: ReviewEvent) -> ReviewEvent:
        self.db.add(review)
        self.db.flush()
        self.db.refresh(review)
        return review
