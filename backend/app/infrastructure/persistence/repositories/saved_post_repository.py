# Adaptador SQLAlchemy del puerto `SavedPostRepository` (domain/posts/saved.py), ADR-047.

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError

from app.domain.posts.saved import SavedPostRepository
from app.extensions import db
from app.infrastructure.persistence.models import SavedPost


class SQLAlchemySavedPostRepository(SavedPostRepository):
    def add(self, user_id, post_id):
        db.session.add(SavedPost(user_id=user_id, post_id=post_id))
        try:
            db.session.commit()
        except IntegrityError:
            # PK (user_id, post_id): ya estaba guardada; idempotente por diseño, como los likes.
            db.session.rollback()
            return False
        return True

    def remove(self, user_id, post_id):
        db.session.execute(
            delete(SavedPost).where(SavedPost.user_id == user_id, SavedPost.post_id == post_id)
        )
        db.session.commit()

    def saved_post_ids(self, user_id, post_ids):
        if not post_ids:
            return set()
        return set(
            db.session.execute(
                select(SavedPost.post_id).where(
                    SavedPost.user_id == user_id, SavedPost.post_id.in_(post_ids)
                )
            )
            .scalars()
            .all()
        )
