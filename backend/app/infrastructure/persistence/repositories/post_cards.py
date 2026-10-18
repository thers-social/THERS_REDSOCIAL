# Publicaciones visibles para una persona, por id y en UNA consulta (ADR-047): las tarjetas de las
# publicaciones compartidas por mensaje. Reutiliza las reglas de privacidad y bloqueo del feed.

from sqlalchemy import select

from app.extensions import db
from app.infrastructure.persistence.models import Post, User
from app.infrastructure.persistence.repositories.post_visibility_sql import (
    not_blocked,
    visible_to_viewer,
)


def fetch_visible_posts(post_ids, viewer_id):
    """`{id: Post}` de las publicaciones de `post_ids` que `viewer_id` puede ver. Las demás (no
    existen, cuenta privada que no sigue, bloqueo) no aparecen: quien presenta decide cómo mostrarlas."""
    ids = [i for i in set(post_ids) if i is not None]
    if not ids or viewer_id is None:
        return {}
    rows = (
        db.session.execute(
            select(Post)
            .join(User, User.id == Post.author_id)
            .where(Post.id.in_(ids), visible_to_viewer(viewer_id), not_blocked(viewer_id))
        )
        .scalars()
        .all()
    )
    return {str(post.id): post for post in rows}
