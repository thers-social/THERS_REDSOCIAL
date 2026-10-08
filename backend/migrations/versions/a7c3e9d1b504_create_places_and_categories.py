"""create place_categories and places with PostGIS (ADR-040 phase 1)

Revision ID: a7c3e9d1b504
Revises: e5b8c3a7d912
Create Date: 2026-10-08

THERS Places, fase 1 (ADR-040-thers-places.md):

- Activa la extensión PostGIS (`CREATE EXTENSION IF NOT EXISTS`). Necesita que el
  rol de la migración pueda crear extensiones: en el Docker local lo es; en Supabase
  hay que comprobarlo antes de fusionar (ADR-040 R2).
- `place_categories`: catálogo de categorías, con las iniciales ya sembradas (son datos
  de referencia que la app necesita en cualquier entorno, no datos de prueba).
- `places`: lugar con `geography(Point, 4326)` e índice GiST. Los valores de
  `verification_status`, `source` y `coordinate_source` se refuerzan con CHECK, no
  con ENUM.

Migración ADITIVA y no destructiva: solo crea objetos nuevos. El `downgrade` borra las
dos tablas pero NO la extensión PostGIS (otras tablas futuras podrían usarla y
eliminarla destruiría sus columnas).
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.types import UserDefinedType

revision = "a7c3e9d1b504"
down_revision = "e5b8c3a7d912"
branch_labels = None
depends_on = None


class _Geography(UserDefinedType):
    """Solo para describir la columna en esta migración (sin `geoalchemy2`)."""

    cache_ok = True

    def get_col_spec(self, **kw):
        return "geography(Point,4326)"


# (slug, nombre, orden). El orden es el de aparición en la app.
_CATEGORIES = [
    ("restaurantes", "Restaurantes", 10),
    ("cafes", "Cafés", 20),
    ("supermercados", "Supermercados", 30),
    ("farmacias", "Farmacias", 40),
    ("gasolineras", "Gasolineras", 50),
    ("hospitales", "Hospitales", 60),
    ("universidades", "Universidades", 70),
    ("centros-comerciales", "Centros comerciales", 80),
    ("parques", "Parques", 90),
    ("entretenimiento", "Entretenimiento", 100),
    ("hoteles", "Hoteles", 110),
    ("otros", "Otros", 999),
]


def upgrade():
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")

    categories = op.create_table(
        "place_categories",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("slug", sa.String(length=60), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.UniqueConstraint("slug", name="uq_place_categories_slug"),
    )

    op.bulk_insert(
        categories,
        [{"slug": slug, "name": name, "sort_order": order} for slug, name, order in _CATEGORIES],
    )

    op.create_table(
        "places",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("slug", sa.String(length=180), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "category_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("place_categories.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("location", _Geography(), nullable=False),
        sa.Column("address", sa.String(length=255), nullable=True),
        sa.Column("municipality", sa.String(length=100), nullable=True),
        sa.Column("department", sa.String(length=100), nullable=True),
        sa.Column("phone", sa.String(length=40), nullable=True),
        sa.Column("website", sa.String(length=255), nullable=True),
        sa.Column(
            "verification_status",
            sa.String(length=20),
            nullable=False,
            server_default=sa.text("'pending'"),
        ),
        sa.Column("source", sa.String(length=20), nullable=False),
        sa.Column("coordinate_source", sa.String(length=20), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column(
            "created_by_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "verified_by_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("last_verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
        ),
        sa.UniqueConstraint("slug", name="uq_places_slug"),
        sa.CheckConstraint(
            "verification_status IN ('pending','verified','needs_review','rejected','inactive')",
            name="ck_places_verification_status",
        ),
        sa.CheckConstraint(
            "source IN ('thers_field','business','community','osm','official')",
            name="ck_places_source",
        ),
        sa.CheckConstraint(
            "coordinate_source IN ('gps','map_selected','geocoded','imported')",
            name="ck_places_coordinate_source",
        ),
    )

    # Índice espacial: lo usan ST_DWithin y el orden por distancia (KNN `<->`).
    op.create_index("ix_places_location", "places", ["location"], postgresql_using="gist")
    op.create_index("ix_places_category_id", "places", ["category_id"])
    op.create_index("ix_places_public", "places", ["is_active", "verification_status"])


def downgrade():
    op.drop_index("ix_places_public", table_name="places")
    op.drop_index("ix_places_category_id", table_name="places")
    op.drop_index("ix_places_location", table_name="places")
    op.drop_table("places")
    op.drop_table("place_categories")
    # No se borra la extensión PostGIS a propósito (ver el docstring).
