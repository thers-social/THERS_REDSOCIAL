# Caso de uso: lista de seguidores / seguidos de una persona (ADR-050).
#
# Misma regla de visibilidad que sus publicaciones (ADR-022): en una cuenta privada que quien
# mira no sigue la lista es privada (CannotViewConnectionsError -> 403). Una cuenta bloqueada en
# cualquier sentido no existe (404, ADR-029) y las cuentas bloqueadas con quien mira no aparecen.

from app.application.media.media_url import media_url
from app.domain.auth.exceptions import UserNotFoundError
from app.domain.follows.exceptions import CannotViewConnectionsError
from app.domain.privacy.visibility import can_view_content_of

DEFAULT_LIMIT = 50
MAX_LIMIT = 100


def list_connections(
    target_id, viewer_id, kind, user_repository, follow_repository, restriction_repository,
    limit=DEFAULT_LIMIT, offset=0,
):
    target = user_repository.find_by_id(target_id)
    is_me = str(target_id) == str(viewer_id)
    if target is None or (not is_me and restriction_repository.is_blocked_between(viewer_id, target_id)):
        raise UserNotFoundError()
    accepted = follow_repository.get_status(viewer_id, target_id) == "accepted"
    if not can_view_content_of(target.is_private, target.id, viewer_id, accepted):
        raise CannotViewConnectionsError()

    fetch = follow_repository.list_followers if kind == "followers" else follow_repository.list_following
    people = fetch(target_id, limit, offset)
    blocked = restriction_repository.blocked_ids_either_way(viewer_id)
    people = [p for p in people if str(p.id) not in blocked]
    statuses = follow_repository.follow_statuses(viewer_id, {p.id for p in people})
    return [
        {
            "id": str(p.id),
            "username": p.username,
            "name": p.name,
            "avatar_url": media_url(p.avatar_path),
            "is_private": p.is_private,
            "is_me": str(p.id) == str(viewer_id),
            "follow_status": statuses.get(p.id),
        }
        for p in people
    ]
