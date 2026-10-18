"""saved posts and posts shared in messages (ADR-047)

Revision ID: a9d3b7e1c542
Revises: d4a7e1b9c356
Create Date: 2026-10-18
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "a9d3b7e1c542"
down_revision = "d4a7e1b9c356"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "saved_posts",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("post_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["post_id"], ["posts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "post_id"),
    )
    op.create_index("ix_saved_posts_user_created", "saved_posts", ["user_id", "created_at"])
    op.add_column("messages", sa.Column("post_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key("messages_post_id_fkey", "messages", "posts", ["post_id"], ["id"], ondelete="SET NULL")


def downgrade():
    op.drop_constraint("messages_post_id_fkey", "messages", type_="foreignkey")
    op.drop_column("messages", "post_id")
    op.drop_index("ix_saved_posts_user_created", table_name="saved_posts")
    op.drop_table("saved_posts")
