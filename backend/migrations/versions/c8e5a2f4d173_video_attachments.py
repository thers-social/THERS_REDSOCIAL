"""short videos in posts and messages (ADR-046)

Revision ID: c8e5a2f4d173
Revises: e1b7c4a9d082
Create Date: 2026-10-18
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "c8e5a2f4d173"
down_revision = "e1b7c4a9d082"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "video_attachments",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("post_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("message_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("storage_key", sa.Text(), nullable=False),
        sa.Column("thumb_key", sa.Text(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint(
            "(post_id IS NOT NULL)::int + (message_id IS NOT NULL)::int = 1",
            name="ck_video_attachments_one_target",
        ),
        sa.CheckConstraint("duration_ms > 0", name="ck_video_attachments_duration_positive"),
        sa.CheckConstraint("size_bytes > 0", name="ck_video_attachments_size_positive"),
        sa.CheckConstraint("width > 0 AND height > 0", name="ck_video_attachments_size_dims"),
        # Todas las claves foráneas son ON DELETE CASCADE: borrar la publicación, el mensaje o la
        # cuenta borra la fila (los archivos los recoge la aplicación, igual que con imágenes y audio).
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["post_id"], ["posts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("post_id"),
        sa.UniqueConstraint("message_id"),
        sa.UniqueConstraint("storage_key"),
        sa.UniqueConstraint("thumb_key"),
    )
    op.create_index("ix_video_attachments_owner_id", "video_attachments", ["owner_id"])


def downgrade():
    op.drop_index("ix_video_attachments_owner_id", table_name="video_attachments")
    op.drop_table("video_attachments")
