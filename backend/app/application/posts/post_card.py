# Forma pública de la tarjeta de una publicación compartida por mensaje (ADR-047). Lo que se ve
# depende de QUIÉN mira: si esa persona no puede ver la publicación (cuenta privada que no sigue,
# bloqueo, borrada), la tarjeta es «no disponible» y no lleva nada de ella.

from app.application.media.attachments import to_public_images, to_public_video

EXCERPT_LENGTH = 140


def _excerpt(text):
    text = " ".join((text or "").split())
    return text if len(text) <= EXCERPT_LENGTH else text[: EXCERPT_LENGTH - 1].rstrip() + "…"


def to_post_card(post_id, posts, viewer_id=None):
    """`posts`: `{id: Post}` de las publicaciones que `viewer_id` puede ver (ver `fetch_visible_posts`)."""
    if post_id is None:
        return None
    post = (posts or {}).get(str(post_id))
    if post is None:
        return {"id": str(post_id), "available": False}
    # Una publicación marcada como sensible no enseña su texto ni su miniatura en la tarjeta (la
    # persona decide abrirla), salvo a su propio autor.
    hidden = post.is_sensitive and str(post.author_id) != str(viewer_id)
    images = to_public_images(post.images)
    video = to_public_video(post.video)
    return {
        "id": str(post.id),
        "available": True,
        "author": {
            "id": str(post.author.id),
            "name": post.author.name,
            "username": post.author.username,
            "avatar_url": getattr(post.author, "avatar_url", None),
        },
        "is_sensitive": bool(post.is_sensitive),
        "excerpt": None if hidden else _excerpt(post.content),
        "thumbnail_url": None
        if hidden
        else (images[0]["url"] if images else (video["thumbnail_url"] if video else None)),
        "has_video": video is not None and not hidden,
    }
