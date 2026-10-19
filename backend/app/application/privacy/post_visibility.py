# Guard compartido de visibilidad de un post concreto
# (ADR-022-private-accounts.md). Lo usan los cuatro casos de uso que operan
# sobre un post ya recuperado por id -- listar/crear comentarios y dar/quitar
# like -- para no reimplementar la regla cuatro veces con cuatro criterios.
#
# La regla en sí vive en domain/privacy/visibility.py (función pura). Este
# módulo solo le consigue los hechos que necesita (¿el autor es privado?,
# ¿el espectador lo sigue?) y traduce un "no" a la excepción que las routes
# ya saben convertir en 404.
#
# El feed (`GET /api/posts`) NO pasa por acá: su filtro vive en SQL, porque
# descartar en Python rompería el límite de la página (ver
# SQLAlchemyPostRepository.list_recent).

from app.domain.posts.audience import AUDIENCE_CLOSE_FRIENDS
from app.domain.posts.exceptions import PostNotFoundError
from app.domain.privacy.visibility import can_view_content_of


def assert_post_visible(
    post, viewer_id, follow_repository, restriction_repository, close_friend_repository=None
):
    """Lanza `PostNotFoundError` si `viewer_id` no puede ver `post`.

    Además de la privacidad de la cuenta (ADR-022), un bloqueo en CUALQUIERA de
    los dos sentidos oculta el post (ADR-029): quien bloqueó no quiere ver ni
    ser visto, y quien fue bloqueado no puede ver ni interactuar.

    **404, no 403**, y con el mismo mensaje que un post inexistente: un 403
    confirmaría que ese post existe y de quién es, que es justo lo que una
    cuenta privada no quiere revelar. Mismo criterio que el 404 indistinguible
    de borrar/editar contenido ajeno (ADR-019/ADR-020/ADR-021 §Seguridad).
    """
    author = post.author

    if restriction_repository.is_blocked_between(viewer_id, author.id):
        raise PostNotFoundError(post.id)

    # La consulta de follow se hace siempre, sin cortocircuitar por
    # `is_private`: es una búsqueda por la UNIQUE (follower_id, followed_id),
    # y replicar acá el "solo preguntá si es privado" duplicaría la regla que
    # can_view_content_of ya define. Estos endpoints operan sobre un único
    # post, no sobre una página -- no hay N+1 que evitar.
    is_accepted_follower = follow_repository.is_following(viewer_id, author.id)

    if not can_view_content_of(author.is_private, author.id, viewer_id, is_accepted_follower):
        raise PostNotFoundError(post.id)

    # Publicación solo para mejores amigos (ADR-054): además de lo anterior, hay que estar en la
    # lista de la autora. Sin el repositorio no se puede comprobar, y ante la duda se niega.
    if post.audience == AUDIENCE_CLOSE_FRIENDS and str(author.id) != str(viewer_id):
        if close_friend_repository is None or not close_friend_repository.is_member(
            author.id, viewer_id
        ):
            raise PostNotFoundError(post.id)
