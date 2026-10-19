"""close friends and story audience (ADR-054)

Revision ID: b2d5f9a1c7e3
Revises: a1c4e8f2b903
Create Date: 2026-10-19 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = 'b2d5f9a1c7e3'
down_revision = 'a1c4e8f2b903'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'close_friends',
        sa.Column('owner_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('friend_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint('owner_id <> friend_id', name='ck_close_friends_not_self'),
        sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['friend_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('owner_id', 'friend_id'),
    )
    op.create_index('ix_close_friends_friend', 'close_friends', ['friend_id'])

    # Las historias existentes siguen siendo para todo el que las veía: `everyone`.
    op.add_column(
        'stories',
        sa.Column('audience', sa.String(length=16), server_default=sa.text("'everyone'"), nullable=False),
    )
    op.create_check_constraint(
        'ck_stories_audience', 'stories', "audience IN ('everyone', 'close_friends')"
    )


def downgrade():
    op.drop_constraint('ck_stories_audience', 'stories', type_='check')
    op.drop_column('stories', 'audience')
    op.drop_index('ix_close_friends_friend', table_name='close_friends')
    op.drop_table('close_friends')
