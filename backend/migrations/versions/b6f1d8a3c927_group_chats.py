"""group chats (ADR-048)

Revision ID: b6f1d8a3c927
Revises: a9d3b7e1c542
Create Date: 2026-10-18
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "b6f1d8a3c927"
down_revision = "a9d3b7e1c542"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "group_chats",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("name", sa.String(length=60), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "group_members",
        sa.Column("group_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("role", sa.String(length=10), server_default="member", nullable=False),
        sa.Column("joined_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("last_read_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["group_id"], ["group_chats.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("group_id", "user_id"),
        sa.CheckConstraint("role IN ('admin', 'member')", name="ck_group_members_role"),
    )
    op.create_index("ix_group_members_user_id", "group_members", ["user_id"])

    op.add_column("messages", sa.Column("group_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key("messages_group_id_fkey", "messages", "group_chats", ["group_id"], ["id"], ondelete="CASCADE")
    op.alter_column("messages", "recipient_id", existing_type=postgresql.UUID(as_uuid=True), nullable=True)
    op.create_check_constraint(
        "ck_messages_one_target", "messages", "(recipient_id IS NULL) <> (group_id IS NULL)"
    )
    op.create_index("ix_messages_group_created", "messages", ["group_id", "created_at"])


def downgrade():
    op.drop_index("ix_messages_group_created", table_name="messages")
    op.drop_constraint("ck_messages_one_target", "messages", type_="check")
    op.execute("DELETE FROM messages WHERE group_id IS NOT NULL")
    op.alter_column("messages", "recipient_id", existing_type=postgresql.UUID(as_uuid=True), nullable=False)
    op.drop_constraint("messages_group_id_fkey", "messages", type_="foreignkey")
    op.drop_column("messages", "group_id")
    op.drop_index("ix_group_members_user_id", table_name="group_members")
    op.drop_table("group_members")
    op.drop_table("group_chats")
