from sqlalchemy.orm import Session

from app.models import Flashcard
from app.repositories.user_repository import UserRepository
from app.repositories.flashcard_repository import FlashcardRepository
from app.repositories.stats_repository import StatsRepository
from app.schemas.flashcard import FlashcardCreateRequest


class FlashcardService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.users = UserRepository(db)
        self.flashcards = FlashcardRepository(db)
        self.stats = StatsRepository(db)

    def create_flashcard(self, user_id: str, payload: FlashcardCreateRequest) -> Flashcard:
        self.users.get_required(user_id)
        flashcard = Flashcard(user_id=user_id, **payload.model_dump())
        created = self.flashcards.create(flashcard)

        user_stats = self.stats.get_or_create(user_id)
        user_stats.total_cards_created += 1

        self.db.commit()
        self.db.refresh(user_stats)
        return created

    def list_flashcards(self, user_id: str, limit: int, offset: int) -> tuple[list[Flashcard], int]:
        self.users.get_required(user_id)
        items = self.flashcards.list_for_user(user_id=user_id, limit=limit, offset=offset)
        total = self.flashcards.count_for_user(user_id=user_id)
        return items, total
