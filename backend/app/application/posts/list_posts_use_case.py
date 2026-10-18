# Caso de uso: listar los posts más recientes (GET /api/posts,
# ADR-004-posts-minimal-model.md). Feed global -- todos los autores, sin
# filtrar por `follows` (esa relación no existe todavía, ver ADR-004
# §Opciones consideradas). Sin paginación real en esta versión -- límite fijo.
#
# viewer_id + like_repository (ADR-005-likes-minimal-model.md),
# comment_repository (ADR-006-comments-minimal-model.md) y
# follow_repository (ADR-007-follows-minimal-model.md): los resúmenes de
# likes/comentarios/follow se resuelven con consultas agregadas sobre todos
# los posts de la página, no una por post -- evita el N+1 que tendría
# preguntar "¿cuántos likes/comentarios tiene?"/"¿lo likeé?"/"¿sigo a este
# autor?" post por post.
#
# Desde ADR-022-private-accounts.md `viewer_id` decide además QUÉ posts entran
# (los de cuentas privadas que no sigue quedan fuera, en SQL), y desde
# ADR-024-content-filters-and-privacy-preferences.md se descartan también los
# que contienen alguno de sus términos filtrados.

from app.application.posts.post_presenter import to_public_post

DEFAULT_LIMIT = 50


def list_posts(
    post_repository, like_repository, comment_repository, follow_repository,
    mention_repository, muted_keyword_repository, viewer_id, limit=DEFAULT_LIMIT,
    place_id=None, post_id=None, saved_repository=None, saved_by=None,
    author_id=None, explore=None, offset=0,
):
    # Una sola consulta de términos para toda la página, no una por post.
    muted_keywords = muted_keyword_repository.list_for_user(viewer_id)

    posts = post_repository.list_recent(
        limit, viewer_id, muted_keywords, place_id=place_id, post_id=post_id, saved_by=saved_by,
        author_id=author_id, explore=explore, offset=offset,
    )
    post_ids = [post.id for post in posts]
    author_ids = {post.author.id for post in posts}

    counts = like_repository.counts_for_posts(post_ids)
    liked_ids = like_repository.liked_post_ids(viewer_id, post_ids)
    # `comments_count` cuenta solo los comentarios que esta persona va a ver
    # (ADR-024): el número de la tarjeta coincide con lo que abre el panel.
    comment_counts = comment_repository.counts_for_posts(post_ids, viewer_id, muted_keywords)
    # {author_id: 'accepted'|'pending'}; los autores ausentes no tienen
    # ninguna relación de follow con el espectador (ADR-022).
    author_follow_statuses = follow_repository.follow_statuses(viewer_id, author_ids)
    mentions_by_post = mention_repository.list_for_posts(post_ids)
    # Las tarjetas de lugar de toda la página, en una sola consulta (ADR-040 fase 4d).
    cards = post_repository.place_cards([post.place_id for post in posts if post.place_id])

    # Cuáles tiene guardadas quien pregunta (ADR-047), en una sola consulta para toda la página.
    saved_ids = saved_repository.saved_post_ids(viewer_id, post_ids) if saved_repository else set()

    return [
        to_public_post(
            post,
            saved_by_me=post.id in saved_ids,
            likes_count=counts.get(post.id, 0),
            liked_by_me=post.id in liked_ids,
            comments_count=comment_counts.get(post.id, 0),
            follow_status=author_follow_statuses.get(post.author.id),
            mentions=mentions_by_post.get(post.id),
            place_cards=cards,
        )
        for post in posts
    ]
