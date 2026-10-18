# Reglas de producto de las historias (ADR-042). Solo tipos nativos: domain/ no importa Flask
# ni SQLAlchemy (BACKEND_ARCHITECTURE.md §7/§17).

from datetime import timedelta

#: Duración fija de una historia (ADR-042 D4: no configurable en la v1).
STORY_TTL = timedelta(hours=24)

#: Texto opcional sobre la imagen.
MAX_STORY_TEXT = 200

#: Margen antes de borrar el ARCHIVO de una historia vencida. Lo que garantiza que no se vea
#: es el filtro `expires_at > now()` de cada lectura, no la purga (ADR-042 §3.4).
FILE_GRACE = timedelta(hours=6)


class StoryNotFoundError(Exception):
    """No existe, venció, no es tuya o no puedes verla: el mismo 404 en todos los casos."""


class StoryTextInvalidError(Exception):
    """El texto supera el máximo o no es una cadena."""


def normalize_story_text(value):
    """`None` si no hay texto; el texto recortado si lo hay. Lanza si no es válido."""
    if value is None:
        return None
    if not isinstance(value, str):
        raise StoryTextInvalidError()
    text = value.strip()
    if not text:
        return None
    if len(text) > MAX_STORY_TEXT:
        raise StoryTextInvalidError()
    return text


class StoryRepository:
    """Puerto de persistencia de historias y vistas."""

    def create(self, author_id, content, storage_key, width, height, expires_at):
        raise NotImplementedError

    def get_active(self, story_id, now):
        """Historia vigente (con su autor) o `None`."""
        raise NotImplementedError

    def strip_for(self, viewer_id, now):
        """Autores con historias vigentes que `viewer_id` puede ver (él mismo incluido)."""
        raise NotImplementedError

    def list_for_author(self, author_id, viewer_id, now):
        """Historias vigentes de un autor, con `seen_by_me`."""
        raise NotImplementedError

    def add_view(self, story_id, viewer_id):
        """Registra la vista. Idempotente: `True` solo si es nueva."""
        raise NotImplementedError

    def list_views(self, story_id, limit):
        raise NotImplementedError

    def delete(self, story_id, author_id):
        """Borra si es del autor. Devuelve `(clave, es_privado)` del archivo o `None`."""
        raise NotImplementedError

    def purge_expired(self, cutoff):
        """Borra las historias con `expires_at < cutoff` y devuelve `(clave, es_privado)` de cada archivo."""
        raise NotImplementedError

    def keys_for_owner(self, owner_id):
        raise NotImplementedError
