from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, Enum as SqlEnum, ForeignKey, Index, Text, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.enums import CardSource, CardType, ReviewRating
from app.models.mixins import TimestampMixin


class Flashcard(TimestampMixin, Base):
    __tablename__ = "flashcards"
    __table_args__ = (
        Index("ix_flashcards_user_type_created", "user_id", "card_type", "created_at"),
        Index("ix_flashcards_user_next_review", "user_id", "next_review_at"),
    )

    id: Mapped[str] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[str] = mapped_column(
        Uuid, ForeignKey("user_accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    source_item_id: Mapped[str | None] = mapped_column(
        Uuid, ForeignKey("source_items.id", ondelete="SET NULL")
    )
    card_type: Mapped[CardType] = mapped_column(
        SqlEnum(CardType, name="card_type_enum"), nullable=False
    )
    front_content: Mapped[str] = mapped_column(Text, nullable=False)
    back_content: Mapped[str] = mapped_column(Text, nullable=False)
    part_of_speech: Mapped[str | None] = mapped_column(String(64))
    zh_tw_definition: Mapped[str | None] = mapped_column(Text)
    explanation: Mapped[str | None] = mapped_column(Text)
    irish_usage: Mapped[str | None] = mapped_column(Text)
    example_sentence: Mapped[str | None] = mapped_column(Text)
    source: Mapped[CardSource | None] = mapped_column(
        SqlEnum(CardSource, name="card_source_enum")
    )
    is_favorite: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    last_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    next_review_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    user: Mapped["UserAccount"] = relationship(back_populates="flashcards")
    source_item: Mapped["SourceItem | None"] = relationship(back_populates="flashcards")
    review_events: Mapped[list["ReviewEvent"]] = relationship(back_populates="flashcard")


class ReviewEvent(Base):
    __tablename__ = "review_events"
    __table_args__ = (
        Index("ix_review_events_user_reviewed_at", "user_id", "reviewed_at"),
        Index("ix_review_events_flashcard_reviewed_at", "flashcard_id", "reviewed_at"),
    )

    id: Mapped[str] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[str] = mapped_column(
        Uuid, ForeignKey("user_accounts.id", ondelete="CASCADE"), nullable=False
    )
    flashcard_id: Mapped[str] = mapped_column(
        Uuid, ForeignKey("flashcards.id", ondelete="CASCADE"), nullable=False
    )
    rating: Mapped[ReviewRating] = mapped_column(
        SqlEnum(ReviewRating, name="review_rating_enum"), nullable=False
    )
    reviewed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    due_before_review: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    next_review_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    user: Mapped["UserAccount"] = relationship(back_populates="review_events")
    flashcard: Mapped["Flashcard"] = relationship(back_populates="review_events")
