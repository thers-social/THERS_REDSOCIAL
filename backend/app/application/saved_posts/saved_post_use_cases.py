# Casos de uso de las publicaciones guardadas (ADR-047). Guardar es PRIVADO (nadie ve qué guardó
# otra persona y no notifica a nadie) e idempotente, igual que los likes (ADR-005).

from app.application.privacy.post_visibility import assert_post_visible
from app.domain.posts.exceptions import PostNotFoundError


def save_post(
    post_id, user_id, post_repository, saved_repository, follow_repository, restriction_repository,
):
    post = post_repository.get_by_id(post_id)
    if post is None:
        raise PostNotFoundError(post_id)
    # No se puede guardar lo que no se puede ver (cuenta privada que no sigue, bloqueo): mismo 404 que
    # un post inexistente, sin revelar que existe.
    assert_post_visible(post, user_id, follow_repository, restriction_repository)
    saved_repository.add(user_id, post_id)
    return {"saved": True}


def unsave_post(post_id, user_id, saved_repository):
    # Nunca 404: quitar un guardado es tocar solo datos propios, y una publicación que ya no se puede
    # ver (borrada, cuenta que pasó a privada) debe poder quitarse de la lista igualmente.
    saved_repository.remove(user_id, post_id)
    return {"saved": False}
