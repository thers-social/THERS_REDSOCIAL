# Adaptador SQLAlchemy del puerto `NotificationRepository`
# (domain/notifications/repositories.py). Único punto del backend que
# traduce entre `notifications` (PostgreSQL) y el resto de las capas --
# domain/ y application/ no importan SQLAlchemy directamente
# (BACKEND_ARCHITECTURE.md §17), mismo patrón que
# like_repository.py/comment_repository.py/follow_repository.py.

from sqlalchemy import func, or_, select, update

from app.domain.notifications.repositories import NotificationRepository
from app.extensions import db
from app.infrastructure.persistence.models import Notification


class SQLAlchemyNotificationRepository(NotificationRepository):
    def create(self, recipient_id, actor_id, notification_type, post_id=None):
        notification = Notification(
            recipient_id=recipient_id,
            actor_id=actor_id,
            type=notification_type,
            post_id=post_id,
        )
        db.session.add(notification)
        db.session.commit()
        return notification

    def list_for_user(self, user_id, limit, excluded_actor_ids=()):
        conditions = [Notification.recipient_id == user_id]
        if excluded_actor_ids:
            # `NOT IN` con un actor nulo (aviso sin actor) daría NULL y lo ocultaría.
            conditions.append(
                or_(
                    Notification.actor_id.is_(None),
                    Notification.actor_id.not_in(list(excluded_actor_ids)),
                )
            )

        return (
            db.session.execute(
                select(Notification)
                .where(*conditions)
                .order_by(Notification.created_at.desc())
                .limit(limit)
            )
            .scalars()
            .all()
        )

    def mark_as_read(self, notification_id, user_id):
        # `func.coalesce(Notification.read_at, func.now())`: solo fija
        # read_at la primera vez -- una segunda llamada sobre la misma
        # notificación no le "renueva" la marca de tiempo de lectura,
        # idempotente por diseño (ADR-008 §Contrato API, mismo criterio que
        # ADR-005/ADR-007). El WHERE con recipient_id == user_id confirma
        # existencia y pertenencia en la misma sentencia -- `rowcount` dice
        # si hubo una fila que matcheara ambas condiciones.
        result = db.session.execute(
            update(Notification)
            .where(
                Notification.id == notification_id,
                Notification.recipient_id == user_id,
            )
            .values(read_at=func.coalesce(Notification.read_at, func.now()))
        )
        db.session.commit()
        return result.rowcount > 0
