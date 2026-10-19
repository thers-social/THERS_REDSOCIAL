# Adaptador SQLAlchemy de la lista de mejores amigos (ADR-054).

from sqlalchemy import delete, func, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.domain.close_friends.rules import CloseFriendRepository
from app.domain.restrictions.kinds import BLOCK
from app.extensions import db
from app.infrastructure.persistence.models import CloseFriend

# Sin bloqueo entre las dos cuentas, en ningún sentido (ADR-029). `:owner` y `u.id` son el par.
_NO_BLOCK = """
    NOT EXISTS (
        SELECT 1 FROM user_restrictions r
        WHERE r.kind = :block
          AND ((r.owner_id = CAST(:owner AS uuid) AND r.target_id = u.id)
            OR (r.owner_id = u.id AND r.target_id = CAST(:owner AS uuid)))
    )
"""


class SQLAlchemyCloseFriendRepository(CloseFriendRepository):
    def list_for(self, owner_id, limit):
        rows = db.session.execute(
            text(
                f"""
                SELECT u.id, u.username, u.name, u.avatar_path, c.created_at
                FROM close_friends c
                JOIN users u ON u.id = c.friend_id
                WHERE c.owner_id = CAST(:owner AS uuid) AND {_NO_BLOCK}
                ORDER BY c.created_at DESC
                LIMIT :limit
                """
            ),
            {"owner": str(owner_id), "block": BLOCK, "limit": limit},
        ).mappings()
        return [dict(row) for row in rows]

    def count(self, owner_id):
        return db.session.execute(
            select(func.count()).select_from(CloseFriend).where(CloseFriend.owner_id == owner_id)
        ).scalar_one()

    def add(self, owner_id, friend_id):
        # `RETURNING` en vez de `rowcount`: con `ON CONFLICT DO NOTHING` el conteo no es fiable.
        inserted = db.session.execute(
            pg_insert(CloseFriend)
            .values(owner_id=owner_id, friend_id=friend_id)
            .on_conflict_do_nothing(index_elements=[CloseFriend.owner_id, CloseFriend.friend_id])
            .returning(CloseFriend.friend_id)
        ).first()
        db.session.commit()
        return inserted is not None

    def remove(self, owner_id, friend_id):
        result = db.session.execute(
            delete(CloseFriend).where(
                CloseFriend.owner_id == owner_id, CloseFriend.friend_id == friend_id
            )
        )
        db.session.commit()
        return result.rowcount > 0

    def is_member(self, owner_id, friend_id):
        return (
            db.session.execute(
                select(CloseFriend.friend_id).where(
                    CloseFriend.owner_id == owner_id, CloseFriend.friend_id == friend_id
                )
            ).first()
            is not None
        )

    def member_ids(self, owner_id):
        rows = db.session.execute(
            select(CloseFriend.friend_id).where(CloseFriend.owner_id == owner_id)
        ).scalars()
        return {str(row) for row in rows}

    def can_add(self, owner_id, friend_id):
        if str(owner_id) == str(friend_id):
            return False
        row = db.session.execute(
            text(f"SELECT 1 FROM users u WHERE u.id = CAST(:friend AS uuid) AND {_NO_BLOCK}"),
            {"owner": str(owner_id), "friend": str(friend_id), "block": BLOCK},
        ).first()
        return row is not None
