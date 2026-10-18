"""Moderation status and private files for Stories (ADR-044, ADR-042)

Existing stories become 'approved' (nothing already published disappears) and the column default is
then switched to 'pending' so a row that does not say its status fails closed. `file_private` marks
the files stored in the PRIVATE bucket/directory; every existing row is public (false).

Revision ID: c6f3a9d2e485
Revises: b5e2f8a1d374
Create Date: 2026-10-18
"""
import sqlalchemy as sa
from alembic import op

revision = "c6f3a9d2e485"
down_revision = "b5e2f8a1d374"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "stories",
        sa.Column("moderation_status", sa.String(10), nullable=False, server_default="approved"),
    )
    op.alter_column("stories", "moderation_status", server_default="pending")
    op.add_column("stories", sa.Column("moderation_decided_by", sa.String(40), nullable=True))
    op.add_column(
        "stories", sa.Column("moderation_decided_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "stories", sa.Column("file_private", sa.Boolean(), nullable=False, server_default="false")
    )
    op.create_check_constraint(
        "ck_stories_moderation_status", "stories",
        "moderation_status IN ('pending', 'approved', 'held', 'rejected')",
    )
    op.create_index("ix_stories_moderation_status", "stories", ["moderation_status"])


def downgrade():
    op.drop_index("ix_stories_moderation_status", table_name="stories")
    op.drop_constraint("ck_stories_moderation_status", "stories", type_="check")
    op.drop_column("stories", "file_private")
    op.drop_column("stories", "moderation_decided_at")
    op.drop_column("stories", "moderation_decided_by")
    op.drop_column("stories", "moderation_status")
