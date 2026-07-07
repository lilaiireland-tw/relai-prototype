from datetime import datetime

from pydantic import BaseModel, Field

from app.models.enums import CardSource, CardType
from app.schemas.common import ORMModel


class FlashcardCreateRequest(BaseModel):
    card_type: CardType
    front_content: str = Field(min_length=1, max_length=500)
    back_content: str = Field(min_length=1)
    part_of_speech: str | None = Field(default=None, max_length=64)
    zh_tw_definition: str | None = None
    explanation: str | None = None
    irish_usage: str | None = None
    example_sentence: str | None = None
    source: CardSource | None = None
    is_favorite: bool = False


class FlashcardResponse(ORMModel):
    id: str
    user_id: str
    card_type: CardType
    front_content: str
    back_content: str
    part_of_speech: str | None
    zh_tw_definition: str | None
    explanation: str | None
    irish_usage: str | None
    example_sentence: str | None
    source: CardSource | None
    is_favorite: bool
    is_archived: bool
    last_reviewed_at: datetime | None
    next_review_at: datetime | None
    created_at: datetime
    updated_at: datetime


class FlashcardListResponse(BaseModel):
    items: list[FlashcardResponse]
    total: int
