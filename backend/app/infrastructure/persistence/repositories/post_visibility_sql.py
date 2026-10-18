# Reglas de visibilidad de una publicación, en SQL (ADR-022 cuentas privadas, ADR-029 bloqueos).
# Las comparten el feed (`list_recent`) y las tarjetas de una publicación compartida por mensaje
# (ADR-047): una tarjeta no puede revelar nada que el feed no mostraría.
#
# Es la traducción literal a SQL de domain/privacy/visibility.py (`can_view_content_of`); cualquier
# cambio de esa regla hay que hacerlo en los dos lugares.

from sqlalchemy import and_, or_, select

from app.domain.follows.follow_status import ACCEPTED
from app.domain.restrictions.kinds import BLOCK
from app.infrastructure.persistence.models import Follow, Post, User, UserRestriction


def visible_to_viewer(viewer_id):
    """El autor no es privado, O es el propio espectador, O el espectador lo sigue (aceptado)."""
    return or_(
        User.is_private.is_(False),
        Post.author_id == viewer_id,
        select(Follow.id)
        .where(
            Follow.follower_id == viewer_id,
            Follow.followed_id == Post.author_id,
            Follow.status == ACCEPTED,
        )
        .exists(),
    )


def not_blocked(viewer_id):
    """Un bloqueo en CUALQUIERA de los dos sentidos oculta la publicación."""
    return ~(
        select(UserRestriction.id)
        .where(
            UserRestriction.kind == BLOCK,
            or_(
                and_(
                    UserRestriction.owner_id == viewer_id,
                    UserRestriction.target_id == Post.author_id,
                ),
                and_(
                    UserRestriction.owner_id == Post.author_id,
                    UserRestriction.target_id == viewer_id,
                ),
            ),
        )
        .exists()
    )
