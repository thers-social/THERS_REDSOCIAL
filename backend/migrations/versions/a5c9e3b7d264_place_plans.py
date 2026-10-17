"""friend plans for places (ADR-040 phase 5)

Revision ID: a5c9e3b7d264
Revises: f4b8d2a6c153
Create Date: 2026-10-08

`place_plans` y `place_plan_members`. Aditiva: no toca tablas existentes.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "a5c9e3b7d264"
down_revision = "f4b8d2a6c153"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "place_plans",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("place_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("places.id", ondelete="CASCADE"), nullable=False),
        sa.Column("creator_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(80), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(12), nullable=False, server_default=sa.text("'active'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.CheckConstraint("status IN ('active','cancelled')", name="ck_place_plans_status"),
    )
    op.create_index("ix_place_plans_place", "place_plans", ["place_id"])
    op.create_index("ix_place_plans_creator_starts", "place_plans", ["creator_id", "starts_at"])

    op.create_table(
        "place_plan_members",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("plan_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("place_plans.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("invited_by", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("status", sa.String(12), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.CheckConstraint("status IN ('invited','going','declined')",
                           name="ck_place_plan_members_status"),
        sa.UniqueConstraint("plan_id", "user_id", name="uq_place_plan_members_pair"),
    )
    op.create_index("ix_place_plan_members_user", "place_plan_members", ["user_id"])


def downgrade():
    op.drop_index("ix_place_plan_members_user", table_name="place_plan_members")
    op.drop_table("place_plan_members")
    op.drop_index("ix_place_plans_creator_starts", table_name="place_plans")
    op.drop_index("ix_place_plans_place", table_name="place_plans")
    op.drop_table("place_plans")
