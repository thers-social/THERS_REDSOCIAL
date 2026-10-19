"""post audience for close friends (ADR-054)

Revision ID: c3e6a0b2d8f4
Revises: b2d5f9a1c7e3
Create Date: 2026-10-19 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'c3e6a0b2d8f4'
down_revision = 'b2d5f9a1c7e3'
branch_labels = None
depends_on = None


def upgrade():
    # Las publicaciones existentes siguen siendo para todo el que las veía: `everyone`.
    op.add_column(
        'posts',
        sa.Column('audience', sa.String(length=16), server_default=sa.text("'everyone'"), nullable=False),
    )
    op.create_check_constraint(
        'ck_posts_audience', 'posts', "audience IN ('everyone', 'close_friends')"
    )


def downgrade():
    op.drop_constraint('ck_posts_audience', 'posts', type_='check')
    op.drop_column('posts', 'audience')
