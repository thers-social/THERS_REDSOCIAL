"""Outbox of domain events toward n8n (ADR-044 section 2.8)

The payload is identifiers, categories and counts only: never text, images or e-mail addresses.

Revision ID: d8a4b2e6f517
Revises: c6f3a9d2e485
Create Date: 2026-10-18
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "d8a4b2e6f517"
down_revision = "c6f3a9d2e485"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "domain_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("event_type", sa.String(40), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column("idempotency_key", sa.String(120), nullable=False),
        sa.Column("status", sa.String(10), nullable=False, server_default="queued"),
        sa.Column("attempts", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("last_error", sa.String(200), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("idempotency_key", name="uq_domain_events_idempotency_key"),
        sa.CheckConstraint(
            "status IN ('queued', 'sent', 'failed', 'dead')", name="ck_domain_events_status"
        ),
    )
    op.create_index(
        "ix_domain_events_dispatch", "domain_events", ["status", "next_attempt_at"],
        postgresql_where=sa.text("status IN ('queued', 'failed')"),
    )


def downgrade():
    op.drop_index("ix_domain_events_dispatch", table_name="domain_events")
    op.drop_table("domain_events")
