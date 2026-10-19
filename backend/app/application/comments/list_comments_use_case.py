# Caso de uso: listar los comentarios de un post (GET
# /api/posts/<post_id>/comments, ADR-006-comments-minimal-model.md). Orden
# cronológico ascendente -- más antiguo primero (ADR-006 §Opciones
# consideradas), a diferencia del feed de posts. Sin paginación real en
# esta versión -- límite fijo.
#
# Desde ADR-022-private-accounts.md el hilo de una cuenta privada no se lee
# desde fuera, y desde ADR-024-content-filters-and-privacy-preferences.md se
# aplican los dos filtros de contenido (términos propios del espectador +
# lista de ofensivos si el dueño de la publicación la activó).

from app.application.comments.comment_presenter import to_public_comment
from app.application.privacy.post_visibility import assert_post_visible
from app.domain.posts.exceptions import PostNotFoundError

DEFAULT_LIMIT = 100


def list_comments(
    post_id, viewer_id, post_repository, comment_repository, follow_repository,
    mention_repository, muted_keyword_repository, restriction_repository,
    limit=DEFAULT_LIMIT, close_friend_repository=None,
):
    post = post_repository.get_by_id(post_id)
    if post is None:
        raise PostNotFoundError(post_id)

    # El hilo de una cuenta privada no se lee desde fuera (ADR-022) -- mismo
    # 404 que un post inexistente.
    assert_post_visible(
        post, viewer_id, follow_repository, restriction_repository, close_friend_repository
    )

    muted_keywords = muted_keyword_repository.list_for_user(viewer_id)
    comments = comment_repository.list_for_post(post_id, limit, viewer_id, muted_keywords)

    # Menciones de todos los comentarios del hilo en una sola consulta
    # (ADR-023) -- no una por comentario.
    mentions_by_comment = mention_repository.list_for_comments([c.id for c in comments])

    return [
        to_public_comment(comment, mentions=mentions_by_comment.get(comment.id))
        for comment in comments
    ]
