"""calls (1-to-1 voice and video calls over LiveKit)

Revision ID: e5a8c2d4f6b1
Revises: d4f7b1c3e9a5
Create Date: 2026-10-20 18:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = 'e5a8c2d4f6b1'
down_revision = 'd4f7b1c3e9a5'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'calls',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('caller_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('callee_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('kind', sa.String(length=8), nullable=False),
        sa.Column('status', sa.String(length=12), server_default=sa.text("'ringing'"), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('answered_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('ended_at', sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint('caller_id <> callee_id', name='ck_calls_no_self_call'),
        sa.CheckConstraint("kind IN ('audio', 'video')", name='ck_calls_kind'),
        sa.CheckConstraint(
            "status IN ('ringing', 'active', 'declined', 'cancelled', 'missed', 'ended')",
            name='ck_calls_status',
        ),
        sa.ForeignKeyConstraint(['caller_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['callee_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_calls_callee_status', 'calls', ['callee_id', 'status'])
    op.create_index('ix_calls_caller_status', 'calls', ['caller_id', 'status'])


def downgrade():
    op.drop_index('ix_calls_caller_status', table_name='calls')
    op.drop_index('ix_calls_callee_status', table_name='calls')
    op.drop_table('calls')
