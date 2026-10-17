# Búsqueda de personas por nombre o usuario (Tero, ADR-041 `users_search`). Es de SOLO LECTURA y
# no es un endpoint público: solo la consulta el caso de uso de la herramienta del asistente.
#
# Las mismas exclusiones que las sugerencias de seguimiento (suggestion_repository.py): nadie se
# ve a sí mismo, un bloqueo en CUALQUIER sentido oculta a la otra persona (ADR-029), y las cuentas
# de moderación y las suspendidas no se descubren (ADR-032). Se devuelven las cuentas privadas
# igual que las sugerencias (solo nombre y usuario: su contenido sigue protegido por ADR-022).

from sqlalchemy import and_, func, or_, select

from app.domain.follows.follow_status import ACCEPTED
from app.domain.restrictions.kinds import BLOCK
from app.extensions import db
from app.infrastructure.persistence.models import Follow, User, UserRestriction


def _escape_like(text):
    """El porcentaje, el guion bajo y la barra son especiales en LIKE: se escapan para buscar el
    texto literal."""
    escape = "\\"
    return text.replace(escape, escape + escape).replace("%", escape + "%").replace("_", escape + "_")


class SQLAlchemyUserSearchRepository:
    def search(self, viewer_id, query, limit):
        pattern = f"%{_escape_like(query)}%"
        prefix = f"{_escape_like(query)}%"

        blocked_either_way = (
            select(UserRestriction.id)
            .where(
                UserRestriction.kind == BLOCK,
                or_(
                    and_(
                        UserRestriction.owner_id == viewer_id,
                        UserRestriction.target_id == User.id,
                    ),
                    and_(
                        UserRestriction.owner_id == User.id,
                        UserRestriction.target_id == viewer_id,
                    ),
                ),
            )
            .exists()
        )
        followers_count = (
            select(func.count())
            .select_from(Follow)
            .where(Follow.followed_id == User.id, Follow.status == ACCEPTED)
            .correlate(User)
            .scalar_subquery()
        )

        return (
            db.session.execute(
                select(User)
                .where(
                    User.id != viewer_id,
                    ~blocked_either_way,
                    User.is_moderator.is_(False),
                    User.suspended_at.is_(None),
                    or_(
                        User.username.ilike(pattern, escape="\\"),
                        User.name.ilike(pattern, escape="\\"),
                    ),
                )
                # Primero quien empieza por lo escrito, luego los más seguidos: es lo que casi
                # siempre se busca. `username` desempata para que el orden sea estable.
                .order_by(
                    User.username.ilike(prefix, escape="\\").desc(),
                    followers_count.desc(),
                    User.username,
                )
                .limit(limit)
            )
            .scalars()
            .all()
        )
