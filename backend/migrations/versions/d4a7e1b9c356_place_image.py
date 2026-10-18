"""image that identifies a place (ADR-046)

Revision ID: d4a7e1b9c356
Revises: c8e5a2f4d173
Create Date: 2026-10-18
"""
import sqlalchemy as sa
from alembic import op

revision = "d4a7e1b9c356"
down_revision = "c8e5a2f4d173"
branch_labels = None
depends_on = None


def upgrade():
    # Clave del archivo en el almacenamiento de medios (`places/<uuid4>.webp`); NULL = sin imagen.
    op.add_column("places", sa.Column("image_key", sa.Text(), nullable=True))


def downgrade():
    op.drop_column("places", "image_key")
