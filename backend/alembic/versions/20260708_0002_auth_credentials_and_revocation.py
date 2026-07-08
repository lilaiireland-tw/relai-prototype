"""add auth credentials and revoked tokens

Revision ID: 20260708_0002
Revises: 20260708_0001
Create Date: 2026-07-08 00:55:00

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260708_0002"
down_revision = "20260708_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("user_accounts", sa.Column("password_hash", sa.String(length=255), nullable=True))

    op.create_table(
        "revoked_tokens",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("jti", sa.String(length=64), nullable=False),
        sa.Column("token_type", sa.String(length=32), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["user_accounts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("jti"),
    )
    op.create_index(op.f("ix_revoked_tokens_jti"), "revoked_tokens", ["jti"], unique=True)
    op.create_index(op.f("ix_revoked_tokens_user_id"), "revoked_tokens", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_revoked_tokens_user_id"), table_name="revoked_tokens")
    op.drop_index(op.f("ix_revoked_tokens_jti"), table_name="revoked_tokens")
    op.drop_table("revoked_tokens")
    op.drop_column("user_accounts", "password_hash")
