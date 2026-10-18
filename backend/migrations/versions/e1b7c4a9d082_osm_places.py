"""unverified places and OpenStreetMap traceability (ADR-043)

Revision ID: e1b7c4a9d082
Revises: a5c9e2f7b136
Create Date: 2026-10-17
"""
import sqlalchemy as sa
from alembic import op

revision = "e1b7c4a9d082"
down_revision = "a5c9e2f7b136"
branch_labels = None
depends_on = None

_OLD = "verification_status IN ('pending','verified','needs_review','rejected','inactive')"
_NEW = "verification_status IN ('pending','verified','needs_review','rejected','inactive','unverified')"


def upgrade():
    op.drop_constraint("ck_places_verification_status", "places", type_="check")
    op.create_check_constraint("ck_places_verification_status", "places", _NEW)
    op.add_column("places", sa.Column("osm_type", sa.String(length=10), nullable=True))
    op.add_column("places", sa.Column("osm_id", sa.BigInteger(), nullable=True))
    op.create_check_constraint(
        "ck_places_osm_type", "places", "osm_type IS NULL OR osm_type IN ('node','way','relation')"
    )
    op.create_index(
        "uq_places_osm_ref",
        "places",
        ["osm_type", "osm_id"],
        unique=True,
        postgresql_where=sa.text("osm_id IS NOT NULL"),
    )


def downgrade():
    op.drop_index("uq_places_osm_ref", table_name="places")
    op.drop_constraint("ck_places_osm_type", "places", type_="check")
    op.drop_column("places", "osm_id")
    op.drop_column("places", "osm_type")
    # Los lugares sin verificar no caben en el CHECK anterior: pasan a `pending` (privado).
    op.execute("UPDATE places SET verification_status = 'pending' WHERE verification_status = 'unverified'")
    op.drop_constraint("ck_places_verification_status", "places", type_="check")
    op.create_check_constraint("ck_places_verification_status", "places", _OLD)
