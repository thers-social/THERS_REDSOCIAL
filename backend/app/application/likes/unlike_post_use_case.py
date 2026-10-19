# Caso de uso: quitar el like de un post (DELETE /api/posts/<post_id>/like,
# ADR-005-likes-minimal-model.md). Idempotente: si el usuario no lo había
# likeado, no falla -- solo devuelve el estado actual.

from app.application.privacy.post_visibility import assert_post_visible
from app.domain.posts.exceptions import PostNotFoundError


def unlike_post(
    post_id, user_id, post_repository, like_repository, follow_repository,
    restriction_repository, close_friend_repository=None,
):
    post = post_repository.get_by_id(post_id)
    if post is None:
        raise PostNotFoundError(post_id)

    assert_post_visible(
        post, user_id, follow_repository, restriction_repository, close_friend_repository
    )

    like_repository.remove(post_id, user_id)

    return {
        "likes_count": like_repository.count_for_post(post_id),
        "liked_by_me": False,
    }
