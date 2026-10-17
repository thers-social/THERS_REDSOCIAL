"""notifications for THERS Places events (ADR-040 fase 12)

Aditiva: `type` se ensancha, `actor_id` admite nulo SOLO para el aviso de un reclamo decidido y
se añaden `place_id`, `object_id` y `detail`. Las filas existentes (like, comment, follow, ...)
no cambian.

Revision ID: b3e7d1a9c486
Revises: a2d6f9c4b857
Create Date: 2026-10-10
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "b3e7d1a9c486"
down_revision = "a2d6f9c4b857"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column("notifications", "type", type_=sa.String(40), existing_type=sa.String(20),
                    existing_nullable=False)
    op.alter_column("notifications", "actor_id", existing_type=postgresql.UUID(as_uuid=True),
                    nullable=True)
    op.add_column(
        "notifications",
        sa.Column("place_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("places.id", ondelete="CASCADE"), nullable=True),
    )
    # Reserva, cotización, plan, reclamo o reseña: sin clave foránea porque apunta a tablas
    # distintas según `type`; el aviso se borra con el lugar y con la persona destinataria.
    op.add_column("notifications", sa.Column("object_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("notifications", sa.Column("detail", sa.String(20), nullable=True))
    # Los eventos de Places siempre llevan lugar; sin actor solo el reclamo decidido.
    op.create_check_constraint(
        "ck_notifications_place_event_has_place",
        "notifications",
        "type NOT LIKE 'place\_%' OR place_id IS NOT NULL",
    )
    op.create_check_constraint(
        "ck_notifications_actor_required",
        "notifications",
        "actor_id IS NOT NULL OR type = 'place_claim_decided'",
    )
    # Un solo aviso por destinatario, tipo, objeto y estado: reintentos o dobles clics no duplican.
    op.execute(
        "CREATE UNIQUE INDEX ux_notifications_place_event ON notifications "
        "(recipient_id, type, object_id, (coalesce(detail, ''))) WHERE object_id IS NOT NULL"
    )
    op.create_index("ix_notifications_place_id", "notifications", ["place_id"])


def downgrade():
    op.drop_index("ix_notifications_place_id", table_name="notifications")
    op.execute("DROP INDEX IF EXISTS ux_notifications_place_event")
    # Los avisos de Places no caben en el esquema anterior: se eliminan antes de restaurarlo.
    op.execute("DELETE FROM notifications WHERE type LIKE 'place\\_%'")
    op.drop_constraint("ck_notifications_actor_required", "notifications", type_="check")
    op.drop_constraint("ck_notifications_place_event_has_place", "notifications", type_="check")
    op.drop_column("notifications", "detail")
    op.drop_column("notifications", "object_id")
    op.drop_column("notifications", "place_id")
    op.alter_column("notifications", "actor_id", existing_type=postgresql.UUID(as_uuid=True),
                    nullable=False)
    op.alter_column("notifications", "type", type_=sa.String(20), existing_type=sa.String(40),
                    existing_nullable=False)
