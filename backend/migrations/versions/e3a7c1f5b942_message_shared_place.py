"""share a place in a direct message (ADR-040 phase 4c)

Revision ID: e3a7c1f5b942
Revises: d2f6b9e4a831
Create Date: 2026-10-08

`messages.place_id` (nullable, ON DELETE SET NULL): un mensaje puede compartir un lugar del
catálogo. Aditiva; los mensajes existentes quedan con NULL. No se usa un `message_type`: la
presencia de `place_id` ya distingue el caso y no abre un enum que habría que mantener.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "e3a7c1f5b942"
down_revision = "d2f6b9e4a831"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "messages",
        sa.Column(
            "place_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("places.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_messages_place_id", "messages", ["place_id"])


def downgrade():
    op.drop_index("ix_messages_place_id", table_name="messages")
    op.drop_column("messages", "place_id")
