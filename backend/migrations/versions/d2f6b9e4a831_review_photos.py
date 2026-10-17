"""allow media attachments on place reviews (ADR-040 phase 4b)

Revision ID: d2f6b9e4a831
Revises: c1e5a8d3f720
Create Date: 2026-10-08

Fotos en reseñas de lugares. `media_attachments` pasa de dos padres posibles (post o
mensaje) a tres (post, mensaje o reseña): se añade `review_id` (CASCADE, como los otros
dos) y el CHECK se reescribe para exigir EXACTAMENTE uno. Los registros existentes cumplen
el CHECK nuevo (ninguno tiene `review_id`).

Aditiva. El `downgrade` falla de forma ruidosa si ya hay fotos de reseñas, en vez de
borrarlas en silencio.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "d2f6b9e4a831"
down_revision = "c1e5a8d3f720"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "media_attachments",
        sa.Column(
            "review_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("place_reviews.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.create_index("ix_media_attachments_review_id", "media_attachments", ["review_id"])
    op.drop_constraint("ck_media_attachments_one_parent", "media_attachments", type_="check")
    op.create_check_constraint(
        "ck_media_attachments_one_parent",
        "media_attachments",
        "((post_id IS NOT NULL)::int + (message_id IS NOT NULL)::int + (review_id IS NOT NULL)::int) = 1",
    )


def downgrade():
    bind = op.get_bind()
    count = bind.execute(sa.text("SELECT count(*) FROM media_attachments WHERE review_id IS NOT NULL")).scalar()
    if count:
        raise RuntimeError(
            f"Hay {count} foto(s) de reseñas: bórralas (y sus archivos) antes de revertir esta migración"
        )
    op.drop_constraint("ck_media_attachments_one_parent", "media_attachments", type_="check")
    op.create_check_constraint(
        "ck_media_attachments_one_parent",
        "media_attachments",
        "(post_id IS NOT NULL AND message_id IS NULL) OR (post_id IS NULL AND message_id IS NOT NULL)",
    )
    op.drop_index("ix_media_attachments_review_id", table_name="media_attachments")
    op.drop_column("media_attachments", "review_id")
