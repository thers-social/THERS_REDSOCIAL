"""add place_reviews (ADR-040 phase 4a)

Revision ID: c1e5a8d3f720
Revises: 65a6decd96ab
Create Date: 2026-10-08

THERS Places, fase 4a: reseñas de lugares.

- Una reseña por persona y lugar (UNIQUE): la base impide duplicados.
- `rating` 1..5 reforzado con CHECK. `body` opcional.
- `is_hidden`: la moderación oculta una reseña sin borrarla (queda en la auditoría).
- CASCADE en ambas FKs: al eliminar la cuenta (ADR-031) desaparecen sus reseñas, igual
  que sus comentarios; al borrar un lugar, las suyas.

Migración ADITIVA y no destructiva.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "c1e5a8d3f720"
down_revision = "65a6decd96ab"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "place_reviews",
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
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("rating", sa.SmallInteger(), nullable=False),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("is_hidden", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
        ),
        sa.CheckConstraint("rating BETWEEN 1 AND 5", name="ck_place_reviews_rating"),
        sa.UniqueConstraint("user_id", "place_id", name="uq_place_reviews_user_place"),
    )
    op.create_index("ix_place_reviews_place_created", "place_reviews", ["place_id", "created_at"])


def downgrade():
    op.drop_index("ix_place_reviews_place_created", table_name="place_reviews")
    op.drop_table("place_reviews")
