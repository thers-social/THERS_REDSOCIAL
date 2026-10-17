"""place claims and managers (ADR-040 fase 6)

Revision ID: b6d1f4a8c375
Revises: a5c9e3b7d264
Create Date: 2026-10-08
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "b6d1f4a8c375"
down_revision = "a5c9e3b7d264"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "place_claims",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("place_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("places.id", ondelete="CASCADE"), nullable=False),
        sa.Column("claimant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.String(12), nullable=False, server_default="pending"),
        sa.Column("business_name", sa.String(160), nullable=False),
        sa.Column("contact_phone", sa.String(40), nullable=True),
        sa.Column("message", sa.Text(), nullable=True),
        # Clave del documento en el almacenamiento PRIVADO; se borra al resolver el reclamo.
        sa.Column("document_key", sa.String(255), nullable=True),
        sa.Column("document_content_type", sa.String(40), nullable=True),
        sa.Column("reviewed_by", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("review_note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.CheckConstraint(
            "status IN ('pending','approved','rejected','withdrawn')",
            name="ck_place_claims_status",
        ),
    )
    # Una persona no puede tener dos reclamos pendientes del mismo lugar.
    op.create_index(
        "uq_place_claims_pending", "place_claims", ["place_id", "claimant_id"],
        unique=True, postgresql_where=sa.text("status = 'pending'"),
    )
    op.create_index("ix_place_claims_status_created", "place_claims", ["status", "created_at"])
    op.create_index("ix_place_claims_claimant", "place_claims", ["claimant_id"])

    op.create_table(
        "place_managers",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("place_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("places.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("claim_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("place_claims.id", ondelete="SET NULL"), nullable=True),
        sa.Column("granted_by", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.UniqueConstraint("place_id", "user_id", name="uq_place_managers_pair"),
    )
    op.create_index("ix_place_managers_user", "place_managers", ["user_id"])


def downgrade():
    op.drop_index("ix_place_managers_user", table_name="place_managers")
    op.drop_table("place_managers")
    op.drop_index("ix_place_claims_claimant", table_name="place_claims")
    op.drop_index("ix_place_claims_status_created", table_name="place_claims")
    op.drop_index("uq_place_claims_pending", table_name="place_claims")
    op.drop_table("place_claims")
