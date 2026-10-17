"""associate a post with a place (ADR-040 phase 4d)

Revision ID: f4b8d2a6c153
Revises: e3a7c1f5b942
Create Date: 2026-10-08

`posts.place_id` (nullable, ON DELETE SET NULL): una publicación puede asociarse a un lugar del
catálogo. Aditiva; las publicaciones existentes quedan con NULL.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "f4b8d2a6c153"
down_revision = "e3a7c1f5b942"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "posts",
        sa.Column(
            "place_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("places.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_posts_place_id_created_at", "posts", ["place_id", "created_at"])


def downgrade():
    op.drop_index("ix_posts_place_id_created_at", table_name="posts")
    op.drop_column("posts", "place_id")
