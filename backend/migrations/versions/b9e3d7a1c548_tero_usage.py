"""monthly Tero AI spend counter (ADR-041 section 8.2)

Revision ID: b9e3d7a1c548
Revises: c9d4a1e7b362
Create Date: 2026-10-17
"""
import sqlalchemy as sa
from alembic import op

revision = "b9e3d7a1c548"
down_revision = "c9d4a1e7b362"
branch_labels = None
depends_on = None


def upgrade():
    # Un contador global por mes UTC. Sin user_id a propósito: solo corta el gasto al llegar al
    # tope; no hay nada que exportar ni borrar por persona (ADR-028/031).
    op.create_table(
        "tero_usage",
        sa.Column("period", sa.String(7), primary_key=True),
        sa.Column("input_tokens", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("output_tokens", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("cost_micro_usd", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.CheckConstraint("period ~ '^[0-9]{4}-[0-9]{2}$'", name="ck_tero_usage_period"),
        sa.CheckConstraint(
            "input_tokens >= 0 AND output_tokens >= 0 AND cost_micro_usd >= 0",
            name="ck_tero_usage_nonnegative",
        ),
    )


def downgrade():
    op.drop_table("tero_usage")
