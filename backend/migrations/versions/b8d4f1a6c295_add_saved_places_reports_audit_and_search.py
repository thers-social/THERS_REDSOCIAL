"""add saved_places, place_reports, admin_audit_log and text search (ADR-040 phase 2)

Revision ID: b8d4f1a6c295
Revises: a7c3e9d1b504
Create Date: 2026-10-08

THERS Places, fase 2 (ADR-040-thers-places.md):

- `saved_places`: lugares guardados por cada persona. PK compuesta (user_id, place_id), así
  que la base impide duplicados.
- `place_reports`: reportes de datos incorrectos de un lugar. El reporte SOBREVIVE a
  quien lo hizo (`reporter_id` SET NULL, igual que `reports`, ADR-032): lo reportado
  puede seguir siendo un problema.
- `admin_audit_log`: registro de acciones de quien modera. `actor_id` SET NULL: el
  registro debe sobrevivir a la cuenta de quien actuó. Nunca guarda secretos.
- Búsqueda de texto insensible a mayúsculas y tildes: extensiones `pg_trgm` y
  `unaccent`, una función `thers_unaccent` INMUTABLE (el `unaccent` de fábrica no lo es,
  y un índice solo puede usar funciones inmutables) y un índice GIN trigram sobre el nombre.

Migración ADITIVA y no destructiva. El `downgrade` borra lo que crea pero NO las
extensiones.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "b8d4f1a6c295"
down_revision = "a7c3e9d1b504"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute("CREATE EXTENSION IF NOT EXISTS unaccent")
    op.execute(
        "CREATE OR REPLACE FUNCTION thers_unaccent(text) RETURNS text "
        "AS $$ SELECT unaccent('unaccent', $1) $$ "
        "LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT"
    )
    op.execute(
        "CREATE INDEX ix_places_name_search ON places "
        "USING gin (thers_unaccent(lower(name)) gin_trgm_ops)"
    )

    op.create_table(
        "saved_places",
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "place_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("places.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
        ),
        sa.PrimaryKeyConstraint("user_id", "place_id", name="pk_saved_places"),
    )
    op.create_index("ix_saved_places_user_created", "saved_places", ["user_id", "created_at"])

    op.create_table(
        "place_reports",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "place_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("places.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "reporter_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("reason", sa.String(length=20), nullable=False),
        sa.Column("details", sa.String(length=500), nullable=True),
        sa.Column("status", sa.String(length=10), nullable=False, server_default=sa.text("'open'")),
        sa.Column(
            "resolved_by_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolution_note", sa.String(length=500), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
        ),
        sa.CheckConstraint(
            "reason IN ('wrong_location','wrong_hours','wrong_phone','closed','duplicate',"
            "'wrong_name','inappropriate','other')",
            name="ck_place_reports_reason",
        ),
        sa.CheckConstraint(
            "status IN ('open','reviewing','resolved','dismissed')",
            name="ck_place_reports_status",
        ),
    )
    op.create_index("ix_place_reports_status_created", "place_reports", ["status", "created_at"])
    op.create_index("ix_place_reports_place_id", "place_reports", ["place_id"])
    # Una persona no puede tener dos reportes ABIERTOS del mismo motivo sobre el mismo lugar.
    op.execute(
        "CREATE UNIQUE INDEX uq_place_reports_open ON place_reports (reporter_id, place_id, reason) "
        "WHERE status IN ('open','reviewing')"
    )

    op.create_table(
        "admin_audit_log",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "actor_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("action", sa.String(length=40), nullable=False),
        sa.Column("resource_type", sa.String(length=30), nullable=False),
        sa.Column("resource_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("changes", postgresql.JSONB(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
        ),
    )
    op.create_index(
        "ix_admin_audit_resource", "admin_audit_log", ["resource_type", "resource_id", "created_at"]
    )


def downgrade():
    op.drop_index("ix_admin_audit_resource", table_name="admin_audit_log")
    op.drop_table("admin_audit_log")
    op.execute("DROP INDEX IF EXISTS uq_place_reports_open")
    op.drop_index("ix_place_reports_place_id", table_name="place_reports")
    op.drop_index("ix_place_reports_status_created", table_name="place_reports")
    op.drop_table("place_reports")
    op.drop_index("ix_saved_places_user_created", table_name="saved_places")
    op.drop_table("saved_places")
    op.execute("DROP INDEX IF EXISTS ix_places_name_search")
    op.execute("DROP FUNCTION IF EXISTS thers_unaccent(text)")
    # No se borran pg_trgm ni unaccent a propósito (ver el docstring).
