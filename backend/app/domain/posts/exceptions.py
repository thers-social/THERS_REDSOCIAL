# Excepciones de dominio para `posts`. Usada tanto por `likes`
# (ADR-005-likes-minimal-model.md) como por `comments`
# (ADR-006-comments-minimal-model.md) para señalar que `post_id` no
# corresponde a ningún post real. Mismo patrón que domain/auth/exceptions.py.


class PostNotFoundError(Exception):
    """`post_id` no corresponde a ningún post real -- id inventado o con
    formato inválido (aunque el conversor `uuid` de Flask ya descarta el
    segundo caso antes de llegar acá, ver interfaces/routes/like_routes.py
    y comment_routes.py)."""


class PostPlaceNotFoundError(Exception):
    """El lugar al que se quiere asociar la publicación no existe o no es público
    (ADR-040 fase 4d)."""
