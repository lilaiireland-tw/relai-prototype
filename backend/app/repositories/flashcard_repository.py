from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Flashcard


class FlashcardRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def create(self, flashcard: Flashcard) -> Flashcard:
        self.db.add(flashcard)
        self.db.flush()
        self.db.refresh(flashcard)
        return flashcard

    def get_for_user(self, flashcard_id: str, user_id: str) -> Flashcard | None:
        statement = select(Flashcard).where(
            Flashcard.id == flashcard_id,
            Flashcard.user_id == user_id,
        )
        return self.db.scalar(statement)

    def list_for_user(self, user_id: str, limit: int, offset: int) -> list[Flashcard]:
        statement = (
            select(Flashcard)
            .where(Flashcard.user_id == user_id, Flashcard.is_archived.is_(False))
            .order_by(Flashcard.created_at.desc())
            .offset(offset)
            .limit(limit)
        )
        return list(self.db.scalars(statement))

    def count_for_user(self, user_id: str) -> int:
        statement = select(func.count()).select_from(Flashcard).where(
            Flashcard.user_id == user_id,
            Flashcard.is_archived.is_(False),
        )
        return int(self.db.scalar(statement) or 0)
