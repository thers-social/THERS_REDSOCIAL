# Caso de uso: dar like a un post (POST /api/posts/<post_id>/like,
# ADR-005-likes-minimal-model.md). Idempotente: si el usuario ya le había
# dado like, no falla -- solo devuelve el estado actual.

from app.application.privacy.post_visibility import assert_post_visible
from app.domain.posts.exceptions import PostNotFoundError


def like_post(
    post_id, user_id, post_repository, like_repository, notification_repository,
    follow_repository, restriction_repository, close_friend_repository=None,
):
    post = post_repository.get_by_id(post_id)
    if post is None:
        raise PostNotFoundError(post_id)

    # No se le puede dar like a lo que no se puede ver: una cuenta privada no
    # recibe likes de quien no la sigue (ADR-022). Mismo 404 que un post
    # inexistente, sin revelar que existe.
    assert_post_visible(
        post, user_id, follow_repository, restriction_repository, close_friend_repository
    )

    was_created = like_repository.add(post_id, user_id)

    # Solo notifica en la transición real (nuevo like, no un POST repetido
    # sobre un like ya existente) y nunca al autor por su propio like
    # (ADR-008-notifications-minimal-model.md §No objetivos).
    if was_created and str(post.author_id) != str(user_id):
        notification_repository.create(
            recipient_id=post.author_id, actor_id=user_id, notification_type="like", post_id=post_id
        )

    return {
        "likes_count": like_repository.count_for_post(post_id),
        "liked_by_me": True,
    }
