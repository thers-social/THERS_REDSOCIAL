# Caso de uso: editar una publicación propia (PATCH /api/posts/<post_id>,
# ADR-021-content-editing.md). `author_id` viene exclusivamente de
# get_jwt_identity() en la route; `content` ya llega validado en formato por
# la route (domain/posts/validators.py, mismo validador que POST /api/posts)
# -- este caso de uso solo orquesta, mismo patrón que
# delete_post_use_case.py (ADR-019).

from app.application.mentions.resolve_mentions import resolve_post_mentions
from app.application.posts.post_presenter import to_public_post
from app.domain.posts.exceptions import PostNotFoundError


def update_post(
    post_id, author_id, content, post_repository, like_repository, comment_repository,
    user_repository, follow_repository, mention_repository, notification_repository,
    muted_keyword_repository, restriction_repository,
):
    post = post_repository.update_content(post_id, author_id, content)
    if post is None:
        # Mismo error tanto si el id no existe como si existe pero es de otro
        # autor -- la route los traduce al mismo 404, sin revelar cuál de los
        # dos ocurrió (ADR-021 §Seguridad, mismo criterio que delete_post).
        raise PostNotFoundError()

    # Las menciones se recalculan sobre el texto nuevo (ADR-023 §Decisión):
    # quitar un @username de una publicación quita la mención; agregar uno
    # nuevo la crea y la notifica. Quien ya estaba mencionado no se re-notifica.
    mentions = resolve_post_mentions(
        post.id, author_id, content, user_repository, follow_repository,
        mention_repository, notification_repository, restriction_repository,
    )

    # A diferencia de create_post, acá los contadores NO pueden asumirse en 0:
    # la publicación ya existía y pudo haber acumulado likes y comentarios,
    # que la edición no toca (el `id` de la fila no cambia, ADR-021
    # §Consecuencias). Devolver 0 dejaría al Frontend pisando su propio
    # estado con contadores falsos.
    post_ids = [post.id]
    likes_counts = like_repository.counts_for_posts(post_ids)
    liked_ids = like_repository.liked_post_ids(author_id, post_ids)
    # Mismo filtro que el feed y que el panel (ADR-024): el autor cuenta los
    # comentarios que él mismo ve, con sus propios términos filtrados aplicados.
    muted_keywords = muted_keyword_repository.list_for_user(author_id)
    comment_counts = comment_repository.counts_for_posts(post_ids, author_id, muted_keywords)

    return to_public_post(
        post,
        likes_count=likes_counts.get(post.id, 0),
        liked_by_me=post.id in liked_ids,
        comments_count=comment_counts.get(post.id, 0),
        mentions=mentions,
        viewer_id=author_id,
        # La edición no cambia el lugar, pero la respuesta tiene que seguir llevando su tarjeta
        # (ADR-040 fase 4d): sin esto un lugar válido se vería como "no disponible".
        place_cards=post_repository.place_cards([post.place_id] if post.place_id else []),
        # `follow_status` queda en su default None y no se consulta a
        # follow_repository: solo el autor puede editar su propia publicación,
        # y nadie se sigue a sí mismo (ck_follows_no_self_follow) -- mismo
        # razonamiento que create_post_use_case (ADR-007).
    )
