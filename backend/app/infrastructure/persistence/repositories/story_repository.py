# Persistencia de historias (ADR-042). Las consultas de lectura filtran SIEMPRE
# `expires_at > now`: es lo que garantiza que una historia vencida no se vea, aunque su fila o
# su archivo sigan ahí hasta la purga (ADR-042 §3.4).

from sqlalchemy import delete, select, text
from sqlalchemy.exc import IntegrityError

from app.domain.restrictions.kinds import BLOCK
from app.domain.stories.rules import StoryRepository
from app.extensions import db
from app.infrastructure.persistence.models import Story, StoryView, User

# Quién puede ver las historias de un autor: él mismo, o quien lo sigue con follow ACEPTADO
# (una solicitud pendiente no cuenta, ADR-022) y sin bloqueo en ninguno de los dos sentidos
# (ADR-029). Es la traducción en SQL de la regla de ADR-042 §2; se usa en la tira y en la
# lectura de historias de una persona para que ambas no puedan divergir.
_VISIBLE_AUTHOR = """
    (
        s.author_id = CAST(:viewer AS uuid)
        OR (
            EXISTS (
                SELECT 1 FROM follows f
                WHERE f.follower_id = CAST(:viewer AS uuid) AND f.followed_id = s.author_id
                  AND f.status = 'accepted'
            )
            AND NOT EXISTS (
                SELECT 1 FROM user_restrictions r
                WHERE r.kind = :block
                  AND ((r.owner_id = CAST(:viewer AS uuid) AND r.target_id = s.author_id)
                    OR (r.owner_id = s.author_id AND r.target_id = CAST(:viewer AS uuid)))
            )
        )
    )
"""


def _story_row(story, author):
    return {
        "id": story.id,
        "author_id": story.author_id,
        "content": story.content,
        "storage_key": story.storage_key,
        "width": story.width,
        "height": story.height,
        "created_at": story.created_at,
        "expires_at": story.expires_at,
        "author_username": author.username,
        "author_name": author.name,
        "author_avatar_path": author.avatar_path,
    }


class SQLAlchemyStoryRepository(StoryRepository):
    def create(self, author_id, content, storage_key, width, height, expires_at):
        story = Story(
            author_id=author_id,
            content=content,
            storage_key=storage_key,
            width=width,
            height=height,
            expires_at=expires_at,
        )
        db.session.add(story)
        db.session.commit()
        author = db.session.get(User, author_id)
        return _story_row(story, author)

    def get_active(self, story_id, now):
        row = db.session.execute(
            select(Story, User)
            .join(User, User.id == Story.author_id)
            .where(Story.id == story_id, Story.expires_at > now)
        ).first()
        return _story_row(*row) if row else None

    def can_view(self, story_author_id, viewer_id):
        """¿Puede `viewer_id` ver las historias de ese autor? Misma regla que la tira."""
        row = db.session.execute(
            text(
                "SELECT 1 FROM (SELECT CAST(:author AS uuid) AS author_id) s WHERE "
                + _VISIBLE_AUTHOR
            ),
            {"viewer": str(viewer_id), "author": str(story_author_id), "block": BLOCK},
        ).first()
        return row is not None

    def strip_for(self, viewer_id, now):
        rows = db.session.execute(
            text(
                f"""
                SELECT u.id AS author_id, u.username, u.name, u.avatar_path,
                       count(*) AS stories_count,
                       max(s.created_at) AS latest_at,
                       (array_agg(s.storage_key ORDER BY s.created_at DESC))[1] AS latest_key,
                       bool_or(v.viewer_id IS NULL AND s.author_id <> CAST(:viewer AS uuid))
                           AS has_unseen
                FROM stories s
                JOIN users u ON u.id = s.author_id
                LEFT JOIN story_views v
                       ON v.story_id = s.id AND v.viewer_id = CAST(:viewer AS uuid)
                WHERE s.expires_at > :now AND {_VISIBLE_AUTHOR}
                GROUP BY u.id, u.username, u.name, u.avatar_path
                ORDER BY (u.id = CAST(:viewer AS uuid)) DESC,
                         bool_or(v.viewer_id IS NULL AND s.author_id <> CAST(:viewer AS uuid))
                             DESC,
                         max(s.created_at) DESC
                """
            ),
            {"viewer": str(viewer_id), "now": now, "block": BLOCK},
        ).mappings()
        return [dict(row) for row in rows]

    def list_for_author(self, author_id, viewer_id, now):
        rows = db.session.execute(
            text(
                f"""
                SELECT s.id, s.author_id, s.content, s.storage_key, s.width, s.height,
                       s.created_at, s.expires_at,
                       u.username AS author_username, u.name AS author_name,
                       u.avatar_path AS author_avatar_path,
                       (v.viewer_id IS NOT NULL) AS seen_by_me
                FROM stories s
                JOIN users u ON u.id = s.author_id
                LEFT JOIN story_views v
                       ON v.story_id = s.id AND v.viewer_id = CAST(:viewer AS uuid)
                WHERE s.author_id = CAST(:author AS uuid) AND s.expires_at > :now
                  AND {_VISIBLE_AUTHOR}
                ORDER BY s.created_at ASC
                """
            ),
            {"viewer": str(viewer_id), "author": str(author_id), "now": now, "block": BLOCK},
        ).mappings()
        return [dict(row) for row in rows]

    def add_view(self, story_id, viewer_id):
        existing = db.session.get(StoryView, (story_id, viewer_id))
        if existing is not None:
            return False
        db.session.add(StoryView(story_id=story_id, viewer_id=viewer_id))
        try:
            db.session.commit()
        except IntegrityError:
            # Carrera: otra petición la registró entre el get y el commit. Idempotente.
            db.session.rollback()
            return False
        return True

    def list_views(self, story_id, limit):
        rows = db.session.execute(
            select(User.id, User.username, User.name, User.avatar_path, StoryView.viewed_at)
            .join(StoryView, StoryView.viewer_id == User.id)
            .where(StoryView.story_id == story_id)
            .order_by(StoryView.viewed_at.desc())
            .limit(limit)
        ).all()
        return [
            {
                "id": r.id,
                "username": r.username,
                "name": r.name,
                "avatar_path": r.avatar_path,
                "viewed_at": r.viewed_at,
            }
            for r in rows
        ]

    def count_views(self, story_id):
        return db.session.execute(
            text("SELECT count(*) FROM story_views WHERE story_id = CAST(:s AS uuid)"),
            {"s": str(story_id)},
        ).scalar_one()

    def delete(self, story_id, author_id):
        key = db.session.execute(
            select(Story.storage_key).where(Story.id == story_id, Story.author_id == author_id)
        ).scalar_one_or_none()
        if key is None:
            return None
        db.session.execute(delete(Story).where(Story.id == story_id, Story.author_id == author_id))
        db.session.commit()
        return key

    def purge_expired(self, cutoff):
        keys = list(
            db.session.execute(
                select(Story.storage_key).where(Story.expires_at < cutoff)
            ).scalars()
        )
        if keys:
            db.session.execute(delete(Story).where(Story.expires_at < cutoff))
            db.session.commit()
        return keys

    def keys_for_owner(self, owner_id):
        return list(
            db.session.execute(
                select(Story.storage_key).where(Story.author_id == owner_id)
            ).scalars()
        )
