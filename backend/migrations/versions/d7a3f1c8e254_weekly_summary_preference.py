"""weekly activity summary preference and last-sent mark (ADR-041 section 7)

Revision ID: d7a3f1c8e254
Revises: c4f8a2d6e913
Create Date: 2026-10-17
"""
import sqlalchemy as sa
from alembic import op

revision = "d7a3f1c8e254"
down_revision = "c4f8a2d6e913"
branch_labels = None
depends_on = None


def upgrade():
    # `false` por defecto: nadie recibe el resumen sin pedirlo. Las filas existentes quedan apagadas.
    op.add_column(
        "users",
        sa.Column("weekly_summary_email", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column("users", sa.Column("weekly_summary_sent_at", sa.DateTime(timezone=True), nullable=True))
    # Índice parcial: la consulta semanal solo mira a quien lo activó, que será una minoría.
    op.create_index(
        "ix_users_weekly_summary_optin", "users", ["id"],
        postgresql_where=sa.text("weekly_summary_email"),
    )


def downgrade():
    op.drop_index("ix_users_weekly_summary_optin", table_name="users")
    op.drop_column("users", "weekly_summary_sent_at")
    op.drop_column("users", "weekly_summary_email")
