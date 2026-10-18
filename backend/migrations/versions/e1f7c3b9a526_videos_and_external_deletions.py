"""Reels on Mux: videos, webhook ledger and external deletions (ADR-043, ADR-043-A, ADR-044)

Revision ID: e1f7c3b9a526
Revises: d8a4b2e6f517
Create Date: 2026-10-18
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "e1f7c3b9a526"
down_revision = "d8a4b2e6f517"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "videos",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("caption", sa.String(200), nullable=True),
        sa.Column("status", sa.String(12), nullable=False, server_default="pending"),
        sa.Column("mux_upload_id", sa.String(80), nullable=True),
        sa.Column("mux_asset_id", sa.String(80), nullable=True),
        sa.Column("mux_playback_id", sa.String(80), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column("failure_reason", sa.String(40), nullable=True),
        # Una reserva de subida por clave del cliente: reintentar no abre una segunda subida en Mux.
        sa.Column("idempotency_key", sa.String(80), nullable=True),
        # Un video NUNCA se ve sin `approved`. Es una tabla nueva (sin filas anteriores que
        # conservar), así que el valor por defecto 'pending' es el único: falla cerrado.
        sa.Column("moderation_status", sa.String(10), nullable=False, server_default="pending"),
        sa.Column("moderation_decided_by", sa.String(40), nullable=True),
        sa.Column("moderation_decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("ready_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('pending', 'uploading', 'processing', 'ready', 'failed', 'blocked')",
            name="ck_videos_status",
        ),
        sa.CheckConstraint(
            "moderation_status IN ('pending', 'approved', 'held', 'rejected')",
            name="ck_videos_moderation_status",
        ),
        sa.CheckConstraint("duration_ms IS NULL OR duration_ms >= 0", name="ck_videos_duration"),
    )
    op.create_index("uq_videos_mux_upload_id", "videos", ["mux_upload_id"], unique=True,
                    postgresql_where=sa.text("mux_upload_id IS NOT NULL"))
    op.create_index("uq_videos_mux_asset_id", "videos", ["mux_asset_id"], unique=True,
                    postgresql_where=sa.text("mux_asset_id IS NOT NULL"))
    op.create_index("uq_videos_owner_idempotency", "videos", ["owner_id", "idempotency_key"],
                    unique=True, postgresql_where=sa.text("idempotency_key IS NOT NULL"))
    op.create_index("ix_videos_feed", "videos", ["status", "moderation_status", "ready_at"])
    op.create_index("ix_videos_owner_created", "videos", ["owner_id", "created_at"])

    # Libro de eventos de Mux: un identificador de evento se procesa UNA vez (un webhook repetido no
    # cambia nada). `deferred` = llegó antes de que existiera el video; se reprocesa después.
    op.create_table(
        "mux_webhook_events",
        sa.Column("event_id", sa.String(80), primary_key=True),
        sa.Column("event_type", sa.String(60), nullable=False),
        sa.Column("object_id", sa.String(80), nullable=True),
        sa.Column("status", sa.String(10), nullable=False, server_default="processed"),
        sa.Column("data", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.CheckConstraint("status IN ('processed', 'deferred', 'ignored')",
                           name="ck_mux_webhook_events_status"),
    )
    op.create_index("ix_mux_webhook_events_deferred", "mux_webhook_events", ["received_at"],
                    postgresql_where=sa.text("status = 'deferred'"))

    # Borrados en proveedores externos con reintentos (ADR-043-A §3): la fila se borra primero y el
    # asset de Mux por esta cola. Sin ella, un fallo de red dejaría un video huérfano cobrando.
    op.create_table(
        "pending_external_deletions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("provider", sa.String(20), nullable=False),
        sa.Column("external_id", sa.String(80), nullable=False),
        sa.Column("status", sa.String(10), nullable=False, server_default="queued"),
        sa.Column("attempts", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("last_error", sa.String(200), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("done_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("provider", "external_id", name="uq_pending_external_deletions_target"),
        sa.CheckConstraint("status IN ('queued', 'done', 'failed', 'dead')",
                           name="ck_pending_external_deletions_status"),
    )
    op.create_index("ix_pending_external_deletions_due", "pending_external_deletions",
                    ["status", "next_attempt_at"],
                    postgresql_where=sa.text("status IN ('queued', 'failed')"))


def downgrade():
    op.drop_index("ix_pending_external_deletions_due", table_name="pending_external_deletions")
    op.drop_table("pending_external_deletions")
    op.drop_index("ix_mux_webhook_events_deferred", table_name="mux_webhook_events")
    op.drop_table("mux_webhook_events")
    for name in ("ix_videos_owner_created", "ix_videos_feed", "uq_videos_owner_idempotency",
                 "uq_videos_mux_asset_id", "uq_videos_mux_upload_id"):
        op.drop_index(name, table_name="videos")
    op.drop_table("videos")
