"""merge tero and stories migration heads

Revision ID: c8dcd63b24d4
Revises: c4f8a2d6e913, d1e5b8f2a640
Create Date: 2026-10-17 23:25:46.139051

Revision de union, sin cambios de esquema. Tero (`b9e3d7a1c548` -> `c4f8a2d6e913`) y Historias
(`d1e5b8f2a640`) colgaban de la misma revision (`c9d4a1e7b362`), asi que al integrarlas habia dos
cabezas. Ninguna toca tablas de la otra, de modo que el orden de aplicacion es indiferente. No se
edito ninguna migracion ya escrita (igual que `f8c2d6a4b190` en su dia).
"""

# revision identifiers, used by Alembic.
revision = "c8dcd63b24d4"
down_revision = ("c4f8a2d6e913", "d1e5b8f2a640")
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
