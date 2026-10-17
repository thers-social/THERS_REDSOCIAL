"""place review replies (ADR-040 fase 7)

Revision ID: c7e2a5b9d486
Revises: b6d1f4a8c375
Create Date: 2026-10-08
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "c7e2a5b9d486"
down_revision = "b6d1f4a8c375"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "place_review_replies",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        # Una respuesta pública por reseña; cae con la reseña.
        sa.Column("review_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("place_reviews.id", ondelete="CASCADE"), nullable=False),
        sa.Column("place_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("places.id", ondelete="CASCADE"), nullable=False),
        sa.Column("author_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.UniqueConstraint("review_id", name="uq_place_review_replies_review"),
    )
    op.create_index("ix_place_review_replies_place", "place_review_replies", ["place_id"])


def downgrade():
    op.drop_index("ix_place_review_replies_place", table_name="place_review_replies")
    op.drop_table("place_review_replies")
