"""initial schema

Revision ID: 20260708_0001
Revises:
Create Date: 2026-07-08 00:00:00

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "20260708_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_accounts",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("display_name", sa.String(length=100), nullable=True),
        sa.Column("auth_provider", sa.Enum("GOOGLE", "APPLE", "EMAIL", name="auth_provider_enum"), nullable=False),
        sa.Column("provider_subject", sa.String(length=255), nullable=True),
        sa.Column("avatar_url", sa.String(length=500), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("onboarding_completed", sa.Boolean(), nullable=False),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
    )
    op.create_index(op.f("ix_user_accounts_email"), "user_accounts", ["email"], unique=False)

    op.create_table(
        "achievements",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("threshold_value", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code"),
    )

    op.create_table(
        "source_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("input_channel", sa.Enum("TEXT", "OCR", "QUIZ", name="input_channel_enum"), nullable=False),
        sa.Column("raw_text", sa.Text(), nullable=False),
        sa.Column("normalized_text", sa.Text(), nullable=True),
        sa.Column("source_language", sa.String(length=16), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["user_accounts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_source_items_user_id"), "source_items", ["user_id"], unique=False)

    op.create_table(
        "user_achievements",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("achievement_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("awarded_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["achievement_id"], ["achievements.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["user_accounts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "achievement_id", name="uq_user_achievement"),
    )

    op.create_table(
        "user_settings",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("interface_language", sa.String(length=16), nullable=False),
        sa.Column("timezone", sa.String(length=64), nullable=False),
        sa.Column("daily_review_goal", sa.Integer(), nullable=False),
        sa.Column("review_reminder_enabled", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["user_accounts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
    )

    op.create_table(
        "user_stats",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("streak_days", sa.Integer(), nullable=False),
        sa.Column("last_active_date", sa.Date(), nullable=True),
        sa.Column("total_cards_created", sa.Integer(), nullable=False),
        sa.Column("total_reviews", sa.Integer(), nullable=False),
        sa.Column("badges_unlocked", sa.JSON(), nullable=False),
        sa.Column("cohort_source", sa.Enum("LILAI_REFERRAL", "ORGANIC", name="cohort_source_enum"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["user_accounts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
    )

    op.create_table(
        "flashcards",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source_item_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("card_type", sa.Enum("VOCABULARY", "ERROR_LOG", name="card_type_enum"), nullable=False),
        sa.Column("front_content", sa.Text(), nullable=False),
        sa.Column("back_content", sa.Text(), nullable=False),
        sa.Column("part_of_speech", sa.String(length=64), nullable=True),
        sa.Column("zh_tw_definition", sa.Text(), nullable=True),
        sa.Column("explanation", sa.Text(), nullable=True),
        sa.Column("irish_usage", sa.Text(), nullable=True),
        sa.Column("example_sentence", sa.Text(), nullable=True),
        sa.Column("source", sa.Enum("USER_INPUT", "IELTS_QUIZ", "ONBOARDING", name="card_source_enum"), nullable=True),
        sa.Column("is_favorite", sa.Boolean(), nullable=False),
        sa.Column("is_archived", sa.Boolean(), nullable=False),
        sa.Column("last_reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("next_review_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["source_item_id"], ["source_items.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["user_accounts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_flashcards_user_next_review", "flashcards", ["user_id", "next_review_at"], unique=False)
    op.create_index("ix_flashcards_user_type_created", "flashcards", ["user_id", "card_type", "created_at"], unique=False)
    op.create_index(op.f("ix_flashcards_user_id"), "flashcards", ["user_id"], unique=False)

    op.create_table(
        "review_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("flashcard_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("rating", sa.Enum("AGAIN", "HARD", "GOOD", "EASY", name="review_rating_enum"), nullable=False),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("due_before_review", sa.DateTime(timezone=True), nullable=True),
        sa.Column("next_review_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["flashcard_id"], ["flashcards.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["user_accounts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_review_events_flashcard_reviewed_at", "review_events", ["flashcard_id", "reviewed_at"], unique=False)
    op.create_index("ix_review_events_user_reviewed_at", "review_events", ["user_id", "reviewed_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_review_events_user_reviewed_at", table_name="review_events")
    op.drop_index("ix_review_events_flashcard_reviewed_at", table_name="review_events")
    op.drop_table("review_events")
    op.drop_index(op.f("ix_flashcards_user_id"), table_name="flashcards")
    op.drop_index("ix_flashcards_user_type_created", table_name="flashcards")
    op.drop_index("ix_flashcards_user_next_review", table_name="flashcards")
    op.drop_table("flashcards")
    op.drop_table("user_stats")
    op.drop_table("user_settings")
    op.drop_table("user_achievements")
    op.drop_index(op.f("ix_source_items_user_id"), table_name="source_items")
    op.drop_table("source_items")
    op.drop_table("achievements")
    op.drop_index(op.f("ix_user_accounts_email"), table_name="user_accounts")
    op.drop_table("user_accounts")

    sa.Enum(name="review_rating_enum").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="card_source_enum").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="card_type_enum").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="cohort_source_enum").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="input_channel_enum").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="auth_provider_enum").drop(op.get_bind(), checkfirst=True)
