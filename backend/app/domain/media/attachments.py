# Imágenes adjuntas a publicaciones y mensajes (ADR-039). Solo tipos nativos:
# domain/ no importa Flask ni SQLAlchemy (BACKEND_ARCHITECTURE.md §7/§17).

#: Límites de producto, explícitos y revisables (no son parámetros de despliegue).
MAX_POST_IMAGES = 4
MAX_MESSAGE_IMAGES = 1


class TooManyImagesError(Exception):
    """Se adjuntaron más imágenes de las permitidas."""


class MediaAttachmentRepository:
    """Puerto de persistencia de `media_attachments`."""

    def add_for_post(self, post_id, owner_id, items):
        """`items`: lista de `{"key", "width", "height"}` ya guardados en el
        almacenamiento. El orden de la lista es el orden de la publicación."""
        raise NotImplementedError

    def add_for_message(self, message_id, owner_id, items):
        raise NotImplementedError

    def keys_for_post(self, post_id, owner_id):
        """Claves de almacenamiento de las imágenes de ese post cuyo dueño es
        `owner_id`. Se llama ANTES de borrar el post (el borrado en cascada
        elimina las filas)."""
        raise NotImplementedError

    def keys_for_message(self, message_id, owner_id):
        raise NotImplementedError
