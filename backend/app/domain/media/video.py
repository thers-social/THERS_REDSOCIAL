# Videos cortos en publicaciones y mensajes (ADR-046). Solo tipos nativos: domain/ no importa
# Flask ni SQLAlchemy (BACKEND_ARCHITECTURE.md §7/§17).

#: Límites de producto, explícitos y revisables (no son parámetros de despliegue).
MAX_VIDEO_SECONDS = 60
#: Tolerancia sobre el tope: el contenedor puede redondear la duración que el cliente respetó.
VIDEO_DURATION_TOLERANCE_SECONDS = 0.5
#: Tope del archivo que sube el cliente.
MAX_VIDEO_UPLOAD_BYTES = 25 * 1024 * 1024
#: Tope de lo que se guarda tras re-codificar. El servidor limita la tasa de bits, así que lo normal
#: queda muy por debajo; esto es la red de seguridad.
MAX_VIDEO_OUTPUT_BYTES = 30 * 1024 * 1024
#: Lados máximos de lo que se decodifica (memoria) y de lo que se guarda (se reduce sin ampliar).
MAX_VIDEO_INPUT_SIDE = 4096
OUTPUT_LONG_SIDE = 1280
OUTPUT_SHORT_SIDE = 720
OUTPUT_MAX_FPS = 30
#: Tope de fotogramas que se procesan (60 s a 60 fps con margen): acota la CPU de un archivo hostil.
MAX_VIDEO_FRAMES = 4000

VIDEO_CONTENT_TYPE = "video/mp4"
THUMBNAIL_CONTENT_TYPE = "image/webp"


class InvalidVideoError(Exception):
    """El archivo no es un video válido de un formato admitido."""


class VideoTooLargeError(Exception):
    """El archivo pesa más del límite."""


class VideoTooLongError(Exception):
    """El video dura más del límite."""


class VideoAttachmentRepository:
    """Puerto de persistencia de `video_attachments`."""

    def add_for_post(self, post_id, owner_id, item):
        """`item`: `{"key", "thumb_key", "width", "height", "duration_ms", "size_bytes"}` ya guardado."""
        raise NotImplementedError

    def add_for_message(self, message_id, owner_id, item):
        raise NotImplementedError

    def keys_for_post(self, post_id, owner_id):
        """Claves de almacenamiento (video y miniatura) del video de ese post cuyo dueño es
        `owner_id`. Se llama ANTES de borrar el post (el borrado en cascada elimina la fila)."""
        raise NotImplementedError

    def keys_for_message(self, message_id, owner_id):
        raise NotImplementedError
