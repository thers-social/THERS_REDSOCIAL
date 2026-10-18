"""Separate moderation roles and appeals (ADR-044 sections 2.5 and 2.7)

Revision ID: f3c9a5e1d742
Revises: e2b8c4d6a931
Create Date: 2026-10-18
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "f3c9a5e1d742"
down_revision = "e2b8c4d6a931"
branch_labels = None
depends_on = None


def upgrade():
    # NULL = sin rol separado. `users.is_moderator` se conserva y equivale a `reviewer`.
    op.add_column("users", sa.Column("moderation_role", sa.String(16), nullable=True))
    op.create_check_constraint(
        "ck_users_moderation_role", "users",
        "moderation_role IS NULL OR moderation_role IN ('reviewer', 'child_safety', 'admin')",
    )

    op.create_table(
        "moderation_appeals",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("subject_type", sa.String(24), nullable=False),
        sa.Column("subject_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("reason", sa.String(500), nullable=False),
        sa.Column("status", sa.String(10), nullable=False, server_default="open"),
        # Quién tomó la decisión apelada: `auto` o el id de la persona. Sirve para exigir que
        # revise otra persona (CHECK de abajo).
        sa.Column("original_decided_by", sa.String(40), nullable=True),
        sa.Column("reviewer_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("resolution_note", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('open', 'upheld', 'overturned')", name="ck_moderation_appeals_status"
        ),
        sa.CheckConstraint(
            "(status = 'open') = (resolved_at IS NULL)", name="ck_moderation_appeals_resolved"
        ),
        # La base impide que quien tomó la decisión original la revise (ADR-044 decisión 4).
        sa.CheckConstraint(
            "original_decided_by IS NULL OR reviewer_id IS NULL "
            "OR CAST(reviewer_id AS text) <> original_decided_by",
            name="ck_moderation_appeals_other_reviewer",
        ),
        sa.CheckConstraint(
            "reviewer_id IS NULL OR reviewer_id <> user_id",
            name="ck_moderation_appeals_not_own",
        ),
    )
    # Una sola apelación abierta por contenido y persona.
    op.create_index(
        "uq_moderation_appeals_open", "moderation_appeals",
        ["user_id", "subject_type", "subject_id"], unique=True,
        postgresql_where=sa.text("status = 'open'"),
    )
    op.create_index("ix_moderation_appeals_status_created", "moderation_appeals",
                    ["status", "created_at"])


def downgrade():
    op.drop_index("ix_moderation_appeals_status_created", table_name="moderation_appeals")
    op.drop_index("uq_moderation_appeals_open", table_name="moderation_appeals")
    op.drop_table("moderation_appeals")
    op.drop_constraint("ck_users_moderation_role", "users", type_="check")
    op.drop_column("users", "moderation_role")
