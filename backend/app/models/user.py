from __future__ import annotations

from datetime import date, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum as SqlEnum,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.enums import AuthProvider, CohortSource, InputChannel
from app.models.mixins import TimestampMixin


class UserAccount(TimestampMixin, Base):
    __tablename__ = "user_accounts"

    id: Mapped[str] = mapped_column(Uuid, primary_key=True, default=uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    password_hash: Mapped[str | None] = mapped_column(String(255))
    display_name: Mapped[str | None] = mapped_column(String(100))
    auth_provider: Mapped[AuthProvider] = mapped_column(
        SqlEnum(AuthProvider, name="auth_provider_enum"),
        nullable=False,
        default=AuthProvider.GOOGLE,
    )
    provider_subject: Mapped[str | None] = mapped_column(String(255))
    avatar_url: Mapped[str | None] = mapped_column(String(500))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    onboarding_completed: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    flashcards: Mapped[list["Flashcard"]] = relationship(back_populates="user")
    source_items: Mapped[list["SourceItem"]] = relationship(back_populates="user")
    review_events: Mapped[list["ReviewEvent"]] = relationship(back_populates="user")
    stats: Mapped["UserStat | None"] = relationship(back_populates="user", uselist=False)
    settings: Mapped["UserSetting | None"] = relationship(back_populates="user", uselist=False)
    achievements: Mapped[list["UserAchievement"]] = relationship(back_populates="user")
    revoked_tokens: Mapped[list["RevokedToken"]] = relationship(back_populates="user")


class SourceItem(TimestampMixin, Base):
    __tablename__ = "source_items"

    id: Mapped[str] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[str] = mapped_column(
        Uuid, ForeignKey("user_accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    input_channel: Mapped[InputChannel] = mapped_column(
        SqlEnum(InputChannel, name="input_channel_enum"),
        nullable=False,
        default=InputChannel.TEXT,
    )
    raw_text: Mapped[str] = mapped_column(Text, nullable=False)
    normalized_text: Mapped[str | None] = mapped_column(Text)
    source_language: Mapped[str | None] = mapped_column(String(16))
    metadata_json: Mapped[dict[str, Any] | None] = mapped_column(JSON)

    user: Mapped["UserAccount"] = relationship(back_populates="source_items")
    flashcards: Mapped[list["Flashcard"]] = relationship(back_populates="source_item")


class UserStat(Base):
    __tablename__ = "user_stats"

    user_id: Mapped[str] = mapped_column(
        Uuid, ForeignKey("user_accounts.id", ondelete="CASCADE"), primary_key=True
    )
    streak_days: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_active_date: Mapped[date | None] = mapped_column(Date)
    total_cards_created: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_reviews: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    badges_unlocked: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    cohort_source: Mapped[CohortSource] = mapped_column(
        SqlEnum(CohortSource, name="cohort_source_enum"),
        nullable=False,
        default=CohortSource.ORGANIC,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    user: Mapped["UserAccount"] = relationship(back_populates="stats")


class UserSetting(TimestampMixin, Base):
    __tablename__ = "user_settings"

    user_id: Mapped[str] = mapped_column(
        Uuid, ForeignKey("user_accounts.id", ondelete="CASCADE"), primary_key=True
    )
    interface_language: Mapped[str] = mapped_column(String(16), nullable=False, default="zh-TW")
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="Asia/Taipei")
    daily_review_goal: Mapped[int] = mapped_column(Integer, nullable=False, default=10)
    review_reminder_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    user: Mapped["UserAccount"] = relationship(back_populates="settings")


class Achievement(TimestampMixin, Base):
    __tablename__ = "achievements"

    id: Mapped[str] = mapped_column(Uuid, primary_key=True, default=uuid4)
    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    threshold_value: Mapped[int | None] = mapped_column(Integer)

    users: Mapped[list["UserAchievement"]] = relationship(back_populates="achievement")


class UserAchievement(Base):
    __tablename__ = "user_achievements"
    __table_args__ = (
        UniqueConstraint("user_id", "achievement_id", name="uq_user_achievement"),
    )

    id: Mapped[str] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[str] = mapped_column(
        Uuid, ForeignKey("user_accounts.id", ondelete="CASCADE"), nullable=False
    )
    achievement_id: Mapped[str] = mapped_column(
        Uuid, ForeignKey("achievements.id", ondelete="CASCADE"), nullable=False
    )
    awarded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    user: Mapped["UserAccount"] = relationship(back_populates="achievements")
    achievement: Mapped["Achievement"] = relationship(back_populates="users")


class RevokedToken(Base):
    __tablename__ = "revoked_tokens"

    id: Mapped[str] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[str] = mapped_column(
        Uuid, ForeignKey("user_accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    jti: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    token_type: Mapped[str] = mapped_column(String(32), nullable=False, default="access")
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    user: Mapped["UserAccount"] = relationship(back_populates="revoked_tokens")
