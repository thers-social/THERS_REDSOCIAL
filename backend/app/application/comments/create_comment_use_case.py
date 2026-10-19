# Caso de uso: crear un comentario (POST /api/posts/<post_id>/comments,
# ADR-006-comments-minimal-model.md). `author_id` viene exclusivamente de
# get_jwt_identity() en la route; `content` ya llega validado en formato
# por la route (domain/comments/validators.py) -- este caso de uso solo
# orquesta, mismo patrón que application/posts/create_post_use_case.py.

from app.application.comments.comment_presenter import to_public_comment
from app.application.mentions.resolve_mentions import resolve_comment_mentions
from app.application.privacy.post_visibility import assert_post_visible
from app.domain.posts.audience import AUDIENCE_CLOSE_FRIENDS
from app.domain.posts.exceptions import PostNotFoundError


def create_comment(
    post_id, author_id, content, post_repository, comment_repository,
    notification_repository, follow_repository, user_repository, mention_repository,
    restriction_repository, close_friend_repository=None,
):
    post = post_repository.get_by_id(post_id)
    if post is None:
        raise PostNotFoundError(post_id)

    # No se comenta lo que no se puede ver (ADR-022).
    assert_post_visible(
        post, author_id, follow_repository, restriction_repository, close_friend_repository
    )

    comment = comment_repository.create(post_id, author_id, content)

    # A diferencia de likes/follows, crear un comentario nunca es un no-op
    # idempotente -- cada llamada es una fila nueva, así que notifica
    # siempre que no sea el propio autor comentando su post
    # (ADR-008-notifications-minimal-model.md §No objetivos).
    if str(post.author_id) != str(author_id):
        notification_repository.create(
            recipient_id=post.author_id, actor_id=author_id, notification_type="comment", post_id=post_id
        )

    # Menciones del comentario (ADR-023). Se resuelven después de crear la fila
    # porque la mención apunta al `comment_id`. La notificación de mención es
    # independiente de la de "comentó tu publicación": a quien mencionan le
    # llega una propia, y al dueño del post la suya -- si son la misma persona,
    # recibe las dos, que describen dos hechos distintos.
    # En una publicación solo para mejores amigos (ADR-054) solo se puede mencionar a quien la ve.
    allowed_ids = (
        close_friend_repository.member_ids(post.author_id)
        if post.audience == AUDIENCE_CLOSE_FRIENDS and close_friend_repository is not None
        else None
    )
    mentions = resolve_comment_mentions(
        comment.id, post_id, author_id, content, user_repository, follow_repository,
        mention_repository, notification_repository, restriction_repository,
        allowed_ids=allowed_ids,
    )

    return to_public_comment(comment, mentions=mentions)
