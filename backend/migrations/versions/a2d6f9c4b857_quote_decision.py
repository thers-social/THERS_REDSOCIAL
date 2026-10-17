"""place quote decision: accepted / rejected by the business (ADR-040 fase 11)

Revision ID: a2d6f9c4b857
Revises: f1b5d8e3a719
Create Date: 2026-10-09
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "a2d6f9c4b857"
down_revision = "f1b5d8e3a719"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "place_quotes",
        sa.Column("status", sa.String(10), nullable=False, server_default="pending"),
    )
    op.add_column("place_quotes", sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "place_quotes",
        sa.Column(
            "decided_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    # Orden estable de las líneas (antes se ordenaban por un UUID aleatorio).
    op.add_column(
        "place_quote_lines",
        sa.Column("position", sa.SmallInteger(), nullable=False, server_default="0"),
    )
    op.create_check_constraint(
        "ck_place_quotes_status", "place_quotes", "status IN ('pending', 'accepted', 'rejected')"
    )
    # Un estado distinto de «pending» siempre trae fecha de decisión.
    op.create_check_constraint(
        "ck_place_quotes_decided",
        "place_quotes",
        "(status = 'pending') = (decided_at IS NULL)",
    )


def downgrade():
    op.drop_column("place_quote_lines", "position")
    op.drop_constraint("ck_place_quotes_decided", "place_quotes", type_="check")
    op.drop_constraint("ck_place_quotes_status", "place_quotes", type_="check")
    op.drop_column("place_quotes", "decided_by")
    op.drop_column("place_quotes", "decided_at")
    op.drop_column("place_quotes", "status")
