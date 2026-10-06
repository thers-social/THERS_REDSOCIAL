"""create media_attachments (images in posts and messages, ADR-039)

Revision ID: a9b4c7e2d815
Revises: e5b8c3a7d912
Create Date: 2026-10-05
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "a9b4c7e2d815"
down_revision = "e5b8c3a7d912"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "media_attachments",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("post_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("message_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("storage_key", sa.Text(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("position", sa.SmallInteger(), server_default=sa.text("0"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "(post_id IS NOT NULL AND message_id IS NULL) "
            "OR (post_id IS NULL AND message_id IS NOT NULL)",
            name="ck_media_attachments_one_parent",
        ),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["post_id"], ["posts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("storage_key"),
    )
    op.create_index("ix_media_attachments_post_id", "media_attachments", ["post_id"])
    op.create_index("ix_media_attachments_message_id", "media_attachments", ["message_id"])
    op.create_index("ix_media_attachments_owner_id", "media_attachments", ["owner_id"])


def downgrade():
    op.drop_index("ix_media_attachments_owner_id", table_name="media_attachments")
    op.drop_index("ix_media_attachments_message_id", table_name="media_attachments")
    op.drop_index("ix_media_attachments_post_id", table_name="media_attachments")
    op.drop_table("media_attachments")
