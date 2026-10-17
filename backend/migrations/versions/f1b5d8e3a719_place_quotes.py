"""place quote catalog and quotes (ADR-040 fase 10)

Revision ID: f1b5d8e3a719
Revises: e9a4c7d2f608
Create Date: 2026-10-08
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "f1b5d8e3a719"
down_revision = "e9a4c7d2f608"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "place_quote_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("place_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("places.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("description", sa.String(300), nullable=True),
        sa.Column("unit", sa.String(10), nullable=False),
        # Dinero SIEMPRE en centavos enteros (nunca float): USD, la moneda de El Salvador.
        sa.Column("unit_price_cents", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.CheckConstraint("unit IN ('person','unit','hour')", name="ck_place_quote_items_unit"),
        sa.CheckConstraint("unit_price_cents BETWEEN 0 AND 100000000", name="ck_place_quote_items_price"),
        sa.UniqueConstraint("place_id", "name", name="uq_place_quote_items_name"),
    )
    op.create_index("ix_place_quote_items_place", "place_quote_items", ["place_id"])

    op.create_table(
        "place_quotes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("place_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("places.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("reservation_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("place_reservations.id", ondelete="SET NULL"), nullable=True),
        sa.Column("currency", sa.String(3), nullable=False, server_default="USD"),
        sa.Column("total_cents", sa.BigInteger(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("valid_until", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.CheckConstraint("total_cents >= 0", name="ck_place_quotes_total"),
    )
    op.create_index("ix_place_quotes_user", "place_quotes", ["user_id", "created_at"])
    op.create_index("ix_place_quotes_place", "place_quotes", ["place_id", "created_at"])

    op.create_table(
        "place_quote_lines",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("quote_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("place_quotes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("item_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("place_quote_items.id", ondelete="SET NULL"), nullable=True),
        # Copia del artículo al cotizar: cambiar o borrar el catálogo no altera cotizaciones emitidas.
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("unit", sa.String(10), nullable=False),
        sa.Column("unit_price_cents", sa.Integer(), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("line_total_cents", sa.BigInteger(), nullable=False),
        sa.CheckConstraint("quantity BETWEEN 1 AND 10000", name="ck_place_quote_lines_quantity"),
    )
    op.create_index("ix_place_quote_lines_quote", "place_quote_lines", ["quote_id"])


def downgrade():
    op.drop_index("ix_place_quote_lines_quote", table_name="place_quote_lines")
    op.drop_table("place_quote_lines")
    op.drop_index("ix_place_quotes_place", table_name="place_quotes")
    op.drop_index("ix_place_quotes_user", table_name="place_quotes")
    op.drop_table("place_quotes")
    op.drop_index("ix_place_quote_items_place", table_name="place_quote_items")
    op.drop_table("place_quote_items")
