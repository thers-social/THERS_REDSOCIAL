"""merge heads: THERS Places (ADR-040) and image attachments (ADR-039)

Revision ID: 65a6decd96ab
Revises: a9b4c7e2d815, b8d4f1a6c295
Create Date: 2026-10-08

Dos ramas de migraciones partían del mismo padre (`e5b8c3a7d912`): `a9b4c7e2d815` (imágenes en
publicaciones y mensajes, ADR-039, PR #90) y `a7c3e9d1b504` -> `b8d4f1a6c295` (THERS Places,
ADR-040). Esta migración las une en una sola cabeza. No toca el esquema: es solo un punto de
unión, igual que `f8c2d6a4b190` en su día.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '65a6decd96ab'
down_revision = ('a9b4c7e2d815', 'b8d4f1a6c295')
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
