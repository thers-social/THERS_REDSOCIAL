"""push devices (ADR-053)

Revision ID: a1c4e8f2b903
Revises: f0719aad83a2
Create Date: 2026-10-18 20:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = 'a1c4e8f2b903'
down_revision = 'f0719aad83a2'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'push_devices',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('token', sa.String(length=4096), nullable=False),
        sa.Column('platform', sa.String(length=16), server_default=sa.text("'android'"), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('last_seen_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint("platform IN ('android', 'ios')", name='ck_push_devices_platform'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('token'),
    )
    op.create_index('ix_push_devices_user', 'push_devices', ['user_id'])


def downgrade():
    op.drop_index('ix_push_devices_user', table_name='push_devices')
    op.drop_table('push_devices')
