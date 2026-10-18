# Adaptador SQLAlchemy de los dispositivos push (ADR-053).

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.extensions import db
from app.infrastructure.persistence.models import PushDevice

MAX_DEVICES_PER_USER = 10


class SQLAlchemyPushDeviceRepository:
    def register(self, user_id, token, platform="android"):
        """UPSERT por token: si ya existía (de otra cuenta incluida) pasa a esta persona."""
        statement = pg_insert(PushDevice).values(user_id=user_id, token=token, platform=platform)
        statement = statement.on_conflict_do_update(
            index_elements=[PushDevice.token],
            set_={"user_id": user_id, "platform": platform, "last_seen_at": func.now()},
        )
        db.session.execute(statement)
        # Tope por persona: se conservan los más recientes (alguien con muchos teléfonos viejos).
        extra = db.session.execute(
            select(PushDevice.id)
            .where(PushDevice.user_id == user_id)
            .order_by(PushDevice.last_seen_at.desc())
            .offset(MAX_DEVICES_PER_USER)
        ).scalars().all()
        if extra:
            db.session.execute(delete(PushDevice).where(PushDevice.id.in_(extra)))
        db.session.commit()

    def unregister(self, user_id, token):
        """Solo borra el dispositivo si es de esta persona."""
        result = db.session.execute(
            delete(PushDevice).where(PushDevice.user_id == user_id, PushDevice.token == token)
        )
        db.session.commit()
        return result.rowcount > 0

    def tokens_for_users(self, user_ids):
        """`{user_id(str): [token, ...]}`."""
        if not user_ids:
            return {}
        rows = db.session.execute(
            select(PushDevice.user_id, PushDevice.token).where(PushDevice.user_id.in_(list(user_ids)))
        ).all()
        grouped = {}
        for user_id, token in rows:
            grouped.setdefault(str(user_id), []).append(token)
        return grouped

    def remove_tokens(self, tokens):
        """Quita tokens que FCM dijo que ya no existen."""
        if not tokens:
            return
        db.session.execute(delete(PushDevice).where(PushDevice.token.in_(list(tokens))))
        db.session.commit()
