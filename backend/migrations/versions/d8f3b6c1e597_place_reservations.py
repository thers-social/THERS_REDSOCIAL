"""place reservations (ADR-040 fase 8)

Revision ID: d8f3b6c1e597
Revises: c7e2a5b9d486
Create Date: 2026-10-08
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "d8f3b6c1e597"
down_revision = "c7e2a5b9d486"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "place_reservation_settings",
        sa.Column("place_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("places.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        # Personas que caben en el mismo horario (suma de reservas pendientes + confirmadas).
        sa.Column("capacity", sa.Integer(), nullable=False, server_default="10"),
        sa.Column("max_party_size", sa.Integer(), nullable=False, server_default="8"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.CheckConstraint("capacity BETWEEN 1 AND 500", name="ck_reservation_settings_capacity"),
        sa.CheckConstraint("max_party_size BETWEEN 1 AND 50 AND max_party_size <= capacity",
                           name="ck_reservation_settings_party"),
    )
    op.create_table(
        "place_reservations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("place_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("places.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("party_size", sa.Integer(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("status", sa.String(12), nullable=False, server_default="pending"),
        sa.Column("decided_by", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("decision_note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.CheckConstraint("status IN ('pending','confirmed','declined','cancelled')",
                           name="ck_place_reservations_status"),
        sa.CheckConstraint("party_size BETWEEN 1 AND 50", name="ck_place_reservations_party"),
    )
    # Una persona no repite la misma reserva activa (mismo lugar y horario).
    op.create_index(
        "uq_place_reservations_active", "place_reservations", ["place_id", "user_id", "starts_at"],
        unique=True, postgresql_where=sa.text("status IN ('pending','confirmed')"),
    )
    op.create_index("ix_place_reservations_slot", "place_reservations", ["place_id", "starts_at"])
    op.create_index("ix_place_reservations_user", "place_reservations", ["user_id", "starts_at"])


def downgrade():
    op.drop_index("ix_place_reservations_user", table_name="place_reservations")
    op.drop_index("ix_place_reservations_slot", table_name="place_reservations")
    op.drop_index("uq_place_reservations_active", table_name="place_reservations")
    op.drop_table("place_reservations")
    op.drop_table("place_reservation_settings")
