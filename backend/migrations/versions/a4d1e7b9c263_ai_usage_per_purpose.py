"""Monthly AI spend counter per purpose (ADR-045 section 2.3)

A new table next to `tero_usage`, which is NOT touched: Tero keeps its own counter.

Revision ID: a4d1e7b9c263
Revises: f3c9a5e1d742
Create Date: 2026-10-18
"""
import sqlalchemy as sa
from alembic import op

revision = "a4d1e7b9c263"
down_revision = "f3c9a5e1d742"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "ai_usage",
        sa.Column("period", sa.String(7), nullable=False),
        sa.Column("purpose", sa.String(40), nullable=False),
        sa.Column("input_tokens", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("output_tokens", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("cost_micro_usd", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("period", "purpose", name="pk_ai_usage"),
        sa.CheckConstraint("period ~ '^[0-9]{4}-[0-9]{2}$'", name="ck_ai_usage_period"),
        sa.CheckConstraint(
            "input_tokens >= 0 AND output_tokens >= 0 AND cost_micro_usd >= 0",
            name="ck_ai_usage_nonnegative",
        ),
    )


def downgrade():
    op.drop_table("ai_usage")
