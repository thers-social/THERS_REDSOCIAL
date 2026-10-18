"""Moderation status on media attachments and the actor kind of the audit log (ADR-044)

Existing rows become 'approved' (nothing already published disappears); the column default is then
switched to 'pending' so a row inserted without an explicit status fails closed.

Revision ID: d7a3f9c1b852
Revises: c8dcd63b24d4
Create Date: 2026-10-18
"""
import sqlalchemy as sa
from alembic import op

revision = "d7a3f9c1b852"
down_revision = "c8dcd63b24d4"
branch_labels = None
depends_on = None


def upgrade():
    # 1) The column is added with 'approved' so every existing row is backfilled as approved.
    op.add_column(
        "media_attachments",
        sa.Column("moderation_status", sa.String(10), nullable=False, server_default="approved"),
    )
    # 2) From now on a row that does not say its status is 'pending' (fails closed).
    op.alter_column("media_attachments", "moderation_status", server_default="pending")
    op.add_column("media_attachments", sa.Column("moderation_decided_by", sa.String(40), nullable=True))
    op.add_column(
        "media_attachments",
        sa.Column("moderation_decided_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_check_constraint(
        "ck_media_attachments_moderation_status",
        "media_attachments",
        "moderation_status IN ('pending', 'approved', 'held', 'rejected')",
    )
    op.create_index(
        "ix_media_attachments_moderation_status", "media_attachments", ["moderation_status"]
    )

    op.add_column(
        "admin_audit_log",
        sa.Column("actor_kind", sa.String(8), nullable=False, server_default="human"),
    )
    op.create_check_constraint(
        "ck_admin_audit_log_actor_kind", "admin_audit_log", "actor_kind IN ('human', 'system')"
    )


def downgrade():
    op.drop_constraint("ck_admin_audit_log_actor_kind", "admin_audit_log", type_="check")
    op.drop_column("admin_audit_log", "actor_kind")
    op.drop_index("ix_media_attachments_moderation_status", table_name="media_attachments")
    op.drop_constraint("ck_media_attachments_moderation_status", "media_attachments", type_="check")
    op.drop_column("media_attachments", "moderation_decided_at")
    op.drop_column("media_attachments", "moderation_decided_by")
    op.drop_column("media_attachments", "moderation_status")
