# Notas de voz en mensajes (ADR-042). Solo tipos nativos: domain/ no importa Flask ni
# SQLAlchemy (BACKEND_ARCHITECTURE.md §7/§17).

#: Límites de producto, explícitos y revisables (no son parámetros de despliegue).
MAX_VOICE_SECONDS = 120
#: Tolerancia sobre el tope: el contenedor puede redondear la duración que el grabador respetó.
VOICE_DURATION_TOLERANCE_SECONDS = 0.5
#: Tope del archivo que sube el cliente (a 32-64 kb/s, 120 s pesan menos de 1 MiB: esto deja margen).
MAX_VOICE_UPLOAD_BYTES = 3 * 1024 * 1024

VOICE_CONTENT_TYPE = "audio/mp4"


class InvalidAudioError(Exception):
    """El archivo no es un audio válido de un formato admitido (o trae vídeo, varios flujos…)."""


class AudioTooLargeError(Exception):
    """El archivo pesa más del límite."""


class AudioTooLongError(Exception):
    """La grabación dura más del límite."""


class AudioAttachmentRepository:
    """Puerto de persistencia de `audio_attachments`."""

    def add_for_message(self, message_id, owner_id, item):
        """`item`: `{"key", "duration_ms", "size_bytes"}` ya guardado en el almacenamiento."""
        raise NotImplementedError

    def keys_for_message(self, message_id, owner_id):
        """Claves de almacenamiento del audio de ese mensaje cuyo dueño es `owner_id`. Se llama
        ANTES de borrar el mensaje (el borrado en cascada elimina la fila)."""
        raise NotImplementedError
