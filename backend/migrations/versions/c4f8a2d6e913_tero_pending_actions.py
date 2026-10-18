"""Tero actions that wait for the person's confirmation (ADR-041 section 6.2)

Revision ID: c4f8a2d6e913
Revises: b9e3d7a1c548
Create Date: 2026-10-17
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "c4f8a2d6e913"
down_revision = "b9e3d7a1c548"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "tero_pending_actions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("params", postgresql.JSONB(), nullable=False),
        sa.Column("summary", sa.String(300), nullable=False),
        sa.Column("status", sa.String(12), nullable=False, server_default="pending"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('pending', 'confirmed', 'cancelled', 'failed')",
            name="ck_tero_pending_actions_status",
        ),
        sa.CheckConstraint(
            "(status = 'pending') = (resolved_at IS NULL)",
            name="ck_tero_pending_actions_resolved",
        ),
    )
    op.create_index(
        "ix_tero_pending_actions_user_created", "tero_pending_actions", ["user_id", "created_at"]
    )


def downgrade():
    op.drop_index("ix_tero_pending_actions_user_created", table_name="tero_pending_actions")
    op.drop_table("tero_pending_actions")
