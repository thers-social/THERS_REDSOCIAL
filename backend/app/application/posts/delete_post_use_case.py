# Caso de uso: borrar una publicación propia (DELETE /api/posts/<post_id>,
# ADR-019-post-deletion.md). `author_id` viene exclusivamente de
# get_jwt_identity() en la route -- solo se puede borrar un post que uno
# mismo publicó. Mismo patrón que delete_message_use_case.py (ADR-014).

from app.application.media.attachments import discard_files
from app.domain.posts.exceptions import PostNotFoundError


def delete_post(post_id, author_id, post_repository, media_repository=None, media_storage=None):
    # Las claves de las imágenes se leen ANTES de borrar: el borrado en cascada
    # elimina las filas. Filtradas por dueño, así que quien no es el autor
    # obtiene una lista vacía y el borrado de abajo igualmente falla (ADR-039).
    keys = media_repository.keys_for_post(post_id, author_id) if media_repository else []

    deleted = post_repository.delete(post_id, author_id)
    if deleted:
        discard_files(keys, media_storage)
    if not deleted:
        # Mismo error tanto si el id no existe como si existe pero es de
        # otro autor -- la route los traduce al mismo 404, sin revelar cuál
        # de los dos ocurrió (ADR-019 §Seguridad).
        raise PostNotFoundError()
    return {"deleted": True}
