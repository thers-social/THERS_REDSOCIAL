# Caso de uso: ver el perfil de OTRA persona (GET /api/users/<id>, ADR-049).
#
# Devuelve solo lo público (nunca email, teléfono, fecha de nacimiento ni banderas internas) más
# la relación de quien mira con ella. Una cuenta bloqueada en cualquier sentido no existe para
# quien pregunta (UserNotFoundError -> 404), igual que el resto de lecturas (ADR-029).

from app.application.media.media_url import media_url
from app.domain.auth.exceptions import UserNotFoundError
from app.domain.privacy.visibility import can_view_content_of


def get_public_profile(
    user_id, viewer_id, user_repository, follow_repository, restriction_repository
):
    user = user_repository.find_by_id(user_id)
    if user is None:
        raise UserNotFoundError()
    if str(user.id) != str(viewer_id) and restriction_repository.is_blocked_between(
        viewer_id, user.id
    ):
        raise UserNotFoundError()

    follow_status = (
        None if str(user.id) == str(viewer_id) else follow_repository.get_status(viewer_id, user.id)
    )
    return {
        "id": str(user.id),
        "username": user.username,
        "name": user.name,
        "bio": user.bio,
        "location": user.location,
        "website": user.website,
        "avatar_url": media_url(user.avatar_path),
        "cover_url": media_url(user.cover_path),
        "is_private": user.is_private,
        "followers_count": follow_repository.followers_count(user.id),
        "following_count": follow_repository.following_count(user.id),
        # null | 'pending' | 'accepted' (ADR-022): `following` real solo con 'accepted'.
        "follow_status": follow_status,
        # false en una cuenta privada que quien mira no sigue: el cliente muestra el candado y
        # no pide publicaciones (el servidor tampoco las daría).
        "can_view_posts": can_view_content_of(
            user.is_private, user.id, viewer_id, follow_status == "accepted"
        ),
    }
