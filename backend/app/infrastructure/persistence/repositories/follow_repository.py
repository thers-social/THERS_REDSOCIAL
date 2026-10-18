# Adaptador SQLAlchemy del puerto `FollowRepository` (domain/follows/repositories.py).
# Único punto del backend que traduce entre `follows` (PostgreSQL) y el
# resto de las capas -- domain/ y application/ no importan SQLAlchemy
# directamente (BACKEND_ARCHITECTURE.md §17), mismo patrón que
# like_repository.py/comment_repository.py.

from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError

from app.domain.follows.follow_status import ACCEPTED, PENDING
from app.domain.follows.repositories import FollowRepository
from app.extensions import db
from app.infrastructure.persistence.models import Follow, User


class SQLAlchemyFollowRepository(FollowRepository):
    def add(self, follower_id, followed_id, status=ACCEPTED):
        follow = Follow(follower_id=follower_id, followed_id=followed_id, status=status)
        db.session.add(follow)
        try:
            db.session.commit()
        except IntegrityError:
            # UNIQUE (follower_id, followed_id) -- ya existía la fila;
            # idempotente por diseño (ADR-007 §Decisión). No se le toca el
            # `status`: un POST repetido no degrada a 'pending' un follow ya
            # aceptado, ni reabre una solicitud (ADR-022 §Decisión).
            db.session.rollback()
            return False
        return True

    def remove(self, follower_id, followed_id):
        db.session.execute(
            delete(Follow).where(
                Follow.follower_id == follower_id, Follow.followed_id == followed_id
            )
        )
        db.session.commit()

    def is_following(self, follower_id, followed_id):
        # Solo cuenta un follow aceptado -- una solicitud pendiente no concede
        # visibilidad ni cuenta como relación (ADR-022 §Decisión).
        return (
            db.session.execute(
                select(Follow.id).where(
                    Follow.follower_id == follower_id,
                    Follow.followed_id == followed_id,
                    Follow.status == ACCEPTED,
                )
            ).first()
            is not None
        )

    def get_status(self, follower_id, followed_id):
        return db.session.execute(
            select(Follow.status).where(
                Follow.follower_id == follower_id,
                Follow.followed_id == followed_id,
            )
        ).scalar_one_or_none()

    def set_status(self, follower_id, followed_id, status):
        # `followed_id` en el propio WHERE: quien acepta/rechaza solo puede
        # tocar solicitudes dirigidas a sí mismo, y eso se confirma en la misma
        # sentencia que la existencia (mismo principio que las operaciones
        # sobre contenido propio, ADR-019/ADR-020/ADR-021).
        result = db.session.execute(
            update(Follow)
            .where(
                Follow.follower_id == follower_id,
                Follow.followed_id == followed_id,
                Follow.status == PENDING,
            )
            .values(status=status)
        )
        db.session.commit()
        return result.rowcount > 0

    def remove_pending(self, follower_id, followed_id):
        # `status == PENDING` en el propio WHERE: este DELETE nunca puede
        # borrar un follow ya aceptado, ni siquiera por error de quien llama
        # (a diferencia de remove(), que borra la relación sea cual sea su
        # estado -- ese es el camino de "dejar de seguir"/"cancelar").
        result = db.session.execute(
            delete(Follow).where(
                Follow.follower_id == follower_id,
                Follow.followed_id == followed_id,
                Follow.status == PENDING,
            )
        )
        db.session.commit()
        return result.rowcount > 0

    def list_pending_requests(self, followed_id, limit):
        # JOIN explícito a `users`: a diferencia de Post.author/Comment.author,
        # `Follow` no declara relationship(lazy="joined"), así que el
        # solicitante se trae en la misma consulta para evitar el N+1.
        rows = db.session.execute(
            select(Follow, User)
            .join(User, User.id == Follow.follower_id)
            .where(Follow.followed_id == followed_id, Follow.status == PENDING)
            .order_by(Follow.created_at.desc())
            .limit(limit)
        ).all()
        return [{"follow": follow, "requester": requester} for follow, requester in rows]

    def pending_requests_count(self, followed_id):
        return db.session.execute(
            select(func.count())
            .select_from(Follow)
            .where(Follow.followed_id == followed_id, Follow.status == PENDING)
        ).scalar_one()

    def followers_count(self, user_id):
        # Solo aceptados: una solicitud pendiente no suma un seguidor
        # (ADR-022 §Decisión) -- si no, el contador anunciaría gente que
        # todavía no tiene acceso a nada.
        return db.session.execute(
            select(func.count())
            .select_from(Follow)
            .where(Follow.followed_id == user_id, Follow.status == ACCEPTED)
        ).scalar_one()

    def following_count(self, user_id):
        return db.session.execute(
            select(func.count())
            .select_from(Follow)
            .where(Follow.follower_id == user_id, Follow.status == ACCEPTED)
        ).scalar_one()

    def follow_statuses(self, follower_id, candidate_ids):
        if not candidate_ids:
            return {}
        # Sin filtrar por status: devuelve el estado real de cada relación
        # (incluidas las pendientes), y es quien llama el que decide qué
        # significa cada uno (ADR-022 §Contrato API).
        rows = db.session.execute(
            select(Follow.followed_id, Follow.status).where(
                Follow.follower_id == follower_id,
                Follow.followed_id.in_(candidate_ids),
            )
        ).all()
        return {followed_id: status for followed_id, status in rows}

    def list_followers(self, user_id, limit, offset):
        return db.session.execute(
            select(User)
            .join(Follow, Follow.follower_id == User.id)
            .where(Follow.followed_id == user_id, Follow.status == ACCEPTED)
            .order_by(Follow.created_at.desc())
            .offset(offset)
            .limit(limit)
        ).scalars().all()

    def list_following(self, user_id, limit, offset):
        return db.session.execute(
            select(User)
            .join(Follow, Follow.followed_id == User.id)
            .where(Follow.follower_id == user_id, Follow.status == ACCEPTED)
            .order_by(Follow.created_at.desc())
            .offset(offset)
            .limit(limit)
        ).scalars().all()
