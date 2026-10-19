# Casos de uso de la lista de mejores amigos (ADR-054). Reciben el repositorio por parámetro, igual
# que el resto de application/ (BACKEND_ARCHITECTURE.md §17).

from app.application.media.media_url import media_url
from app.domain.close_friends.rules import (
    MAX_CLOSE_FRIENDS,
    CloseFriendsLimitError,
    CloseFriendTargetNotFoundError,
)


def _present(row):
    return {
        "id": str(row["id"]),
        "username": row["username"],
        "name": row["name"],
        "avatar_url": media_url(row["avatar_path"]),
        "added_at": row["created_at"].isoformat(),
    }


def list_close_friends(owner_id, repository):
    friends = repository.list_for(owner_id, MAX_CLOSE_FRIENDS)
    return {"friends": [_present(row) for row in friends], "limit": MAX_CLOSE_FRIENDS}


def add_close_friend(owner_id, friend_id, repository):
    """Idempotente: añadir a quien ya está devuelve `added: False` sin error."""
    if not repository.can_add(owner_id, friend_id):
        # Mismo error para «no existe», «eres tú» y «hay un bloqueo»: no se revela cuál.
        raise CloseFriendTargetNotFoundError()
    if repository.count(owner_id) >= MAX_CLOSE_FRIENDS:
        raise CloseFriendsLimitError()
    return {"added": repository.add(owner_id, friend_id)}


def remove_close_friend(owner_id, friend_id, repository):
    """Idempotente: quitar a quien no está devuelve `removed: False`."""
    return {"removed": repository.remove(owner_id, friend_id)}
