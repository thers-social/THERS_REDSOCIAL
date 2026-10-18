"""Merge the Stories and the content moderation heads

Empty: only joins the two branches of migrations so there is a single head again.

Revision ID: b5e2f8a1d374
Revises: a4d1e7b9c263, c8dcd63b24d4
Create Date: 2026-10-18
"""

revision = "b5e2f8a1d374"
down_revision = ("a4d1e7b9c263", "c8dcd63b24d4")
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
