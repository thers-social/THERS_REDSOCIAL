"""Persistent moderation jobs and classification results (ADR-044)

The job payload is identifiers only and the result never stores the evaluated content.

Revision ID: e2b8c4d6a931
Revises: d7a3f9c1b852
Create Date: 2026-10-18
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "e2b8c4d6a931"
down_revision = "d7a3f9c1b852"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "moderation_jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("kind", sa.String(24), nullable=False),
        sa.Column("subject_type", sa.String(24), nullable=False),
        sa.Column("subject_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("idempotency_key", sa.String(120), nullable=False),
        sa.Column("status", sa.String(10), nullable=False, server_default="queued"),
        sa.Column("attempts", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("locked_by", sa.String(60), nullable=True),
        sa.Column("locked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.String(200), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("idempotency_key", name="uq_moderation_jobs_idempotency_key"),
        sa.CheckConstraint(
            "status IN ('queued', 'running', 'succeeded', 'failed', 'dead')",
            name="ck_moderation_jobs_status",
        ),
    )
    # The worker claims by (status, next_attempt_at): the index only covers what is still pending.
    op.create_index(
        "ix_moderation_jobs_claim", "moderation_jobs", ["status", "next_attempt_at"],
        postgresql_where=sa.text("status IN ('queued', 'failed', 'running')"),
    )
    op.create_index("ix_moderation_jobs_subject", "moderation_jobs", ["subject_type", "subject_id"])

    op.create_table(
        "moderation_results",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("job_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("moderation_jobs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", sa.String(40), nullable=False),
        sa.Column("model_version", sa.String(60), nullable=False),
        sa.Column("categories", postgresql.JSONB(), nullable=False,
                  server_default=sa.text("'{}'::jsonb")),
        sa.Column("scores", postgresql.JSONB(), nullable=False,
                  server_default=sa.text("'{}'::jsonb")),
        sa.Column("decision", sa.String(10), nullable=False),
        sa.Column("priority", sa.String(8), nullable=False, server_default="normal"),
        sa.Column("policy_version", sa.String(20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        # One result per job: re-delivering a finished job cannot write a second one.
        sa.UniqueConstraint("job_id", name="uq_moderation_results_job_id"),
        sa.CheckConstraint(
            "decision IN ('approved', 'held', 'pending')", name="ck_moderation_results_decision"
        ),
        sa.CheckConstraint(
            "priority IN ('normal', 'high', 'critical')", name="ck_moderation_results_priority"
        ),
    )


def downgrade():
    op.drop_table("moderation_results")
    op.drop_index("ix_moderation_jobs_subject", table_name="moderation_jobs")
    op.drop_index("ix_moderation_jobs_claim", table_name="moderation_jobs")
    op.drop_table("moderation_jobs")
