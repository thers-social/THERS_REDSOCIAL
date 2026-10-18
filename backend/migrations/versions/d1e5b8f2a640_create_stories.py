"""create stories and story_views (ADR-042)

Revision ID: d1e5b8f2a640
Revises: c9d4a1e7b362
Create Date: 2026-10-17

Historias de 24 horas (ADR-042-stories.md). Migración ADITIVA y no destructiva:

- `stories`: una imagen con texto opcional. `expires_at` se guarda. `ON DELETE CASCADE`
  desde `users`, así que eliminar la cuenta se lleva las filas (los ARCHIVOS los recoge
  `account_deletion_repository`, igual que con `media_attachments`).
- `story_views`: quién la vio. Clave compuesta (story_id, viewer_id).
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "d1e5b8f2a640"
down_revision = "c9d4a1e7b362"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "stories",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "author_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("content", sa.String(200), nullable=True),
        sa.Column("storage_key", sa.Text, nullable=False, unique=True),
        sa.Column("width", sa.Integer, nullable=False),
        sa.Column("height", sa.Integer, nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_stories_author_expires", "stories", ["author_id", "expires_at"])
    op.create_index("ix_stories_expires_at", "stories", ["expires_at"])

    op.create_table(
        "story_views",
        sa.Column(
            "story_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("stories.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "viewer_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "viewed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
        ),
    )


def downgrade():
    op.drop_table("story_views")
    op.drop_index("ix_stories_expires_at", table_name="stories")
    op.drop_index("ix_stories_author_expires", table_name="stories")
    op.drop_table("stories")
