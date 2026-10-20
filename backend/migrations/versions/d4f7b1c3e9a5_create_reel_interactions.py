"""reel likes, saves and comments (ADR-055)

Revision ID: d4f7b1c3e9a5
Revises: c3e6a0b2d8f4
Create Date: 2026-10-20 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = 'd4f7b1c3e9a5'
down_revision = 'c3e6a0b2d8f4'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'video_likes',
        sa.Column('video_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['video_id'], ['videos.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('video_id', 'user_id'),
    )
    op.create_index('ix_video_likes_user_id', 'video_likes', ['user_id'])

    op.create_table(
        'video_saves',
        sa.Column('video_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['video_id'], ['videos.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('video_id', 'user_id'),
    )
    op.create_index('ix_video_saves_user_id_created_at', 'video_saves', ['user_id', 'created_at'])

    op.create_table(
        'video_comments',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('video_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('author_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('content', sa.String(length=1000), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint('length(btrim(content)) > 0', name='ck_video_comments_content_not_blank'),
        sa.ForeignKeyConstraint(['video_id'], ['videos.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['author_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_video_comments_video_id_created_at', 'video_comments', ['video_id', 'created_at'])


def downgrade():
    op.drop_index('ix_video_comments_video_id_created_at', table_name='video_comments')
    op.drop_table('video_comments')
    op.drop_index('ix_video_saves_user_id_created_at', table_name='video_saves')
    op.drop_table('video_saves')
    op.drop_index('ix_video_likes_user_id', table_name='video_likes')
    op.drop_table('video_likes')
