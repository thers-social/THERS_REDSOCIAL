"""anonymous daily visit counters for places (ADR-040 §33)

Revision ID: c9d4a1e7b362
Revises: b3e7d1a9c486
Create Date: 2026-10-12
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "c9d4a1e7b362"
down_revision = "b3e7d1a9c486"
branch_labels = None
depends_on = None


def upgrade():
    # Un contador por lugar, DÍA LOCAL (UTC-6) y tipo de evento. Sin user_id a propósito:
    # no hay nada que exportar ni borrar por persona (ADR-028/031).
    op.create_table(
        "place_visit_counts",
        sa.Column("place_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("places.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("day", sa.Date(), primary_key=True),
        sa.Column("event", sa.String(16), primary_key=True),
        sa.Column("count", sa.Integer(), nullable=False, server_default="0"),
        sa.CheckConstraint("event IN ('view', 'phone', 'website', 'directions')",
                           name="ck_place_visit_counts_event"),
        sa.CheckConstraint("count >= 0", name="ck_place_visit_counts_count"),
    )


def downgrade():
    op.drop_table("place_visit_counts")
