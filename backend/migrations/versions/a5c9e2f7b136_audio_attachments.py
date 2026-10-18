"""voice notes in direct messages (ADR-042)

Revision ID: a5c9e2f7b136
Revises: d7a3f1c8e254
Create Date: 2026-10-17
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "a5c9e2f7b136"
down_revision = "d7a3f1c8e254"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "audio_attachments",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("message_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("storage_key", sa.Text(), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("duration_ms > 0", name="ck_audio_attachments_duration_positive"),
        sa.CheckConstraint("size_bytes > 0", name="ck_audio_attachments_size_positive"),
        # Todas las claves foráneas son ON DELETE CASCADE: borrar el mensaje o la cuenta borra la fila
        # (los archivos los recoge la aplicación, igual que con las imágenes, ADR-039).
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("message_id"),
        sa.UniqueConstraint("storage_key"),
    )
    op.create_index("ix_audio_attachments_owner_id", "audio_attachments", ["owner_id"])


def downgrade():
    op.drop_index("ix_audio_attachments_owner_id", table_name="audio_attachments")
    op.drop_table("audio_attachments")
