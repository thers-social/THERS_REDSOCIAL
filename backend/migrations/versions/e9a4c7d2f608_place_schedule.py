"""place opening hours and closures (ADR-040 fase 9)

Revision ID: e9a4c7d2f608
Revises: d8f3b6c1e597
Create Date: 2026-10-08
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "e9a4c7d2f608"
down_revision = "d8f3b6c1e597"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "place_opening_hours",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("place_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("places.id", ondelete="CASCADE"), nullable=False),
        # 0 = lunes ... 6 = domingo. Hora local del lugar (El Salvador, UTC-6 fijo).
        sa.Column("weekday", sa.SmallInteger(), nullable=False),
        sa.Column("opens", sa.Time(), nullable=False),
        sa.Column("closes", sa.Time(), nullable=False),
        sa.CheckConstraint("weekday BETWEEN 0 AND 6", name="ck_place_opening_hours_weekday"),
        sa.CheckConstraint("closes > opens", name="ck_place_opening_hours_order"),
        sa.UniqueConstraint("place_id", "weekday", "opens", name="uq_place_opening_hours_start"),
    )
    op.create_index("ix_place_opening_hours_place", "place_opening_hours", ["place_id", "weekday"])

    op.create_table(
        "place_closures",
        sa.Column("place_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("places.id", ondelete="CASCADE"), nullable=False),
        sa.Column("closed_on", sa.Date(), nullable=False),
        sa.Column("reason", sa.String(120), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("place_id", "closed_on", name="pk_place_closures"),
    )


def downgrade():
    op.drop_table("place_closures")
    op.drop_index("ix_place_opening_hours_place", table_name="place_opening_hours")
    op.drop_table("place_opening_hours")
