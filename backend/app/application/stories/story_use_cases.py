# Casos de uso de las historias (ADR-042). Reciben los repositorios y el almacenamiento por
# parámetro, igual que el resto de application/ (BACKEND_ARCHITECTURE.md §17).

import uuid
from datetime import datetime, timezone

from app.application.media.attachments import discard_files
from app.application.media.image_visibility import is_enabled as moderation_enabled
from app.application.media.media_url import media_url
from app.domain.content_moderation.status import APPROVED, initial_status
from app.domain.stories.rules import (
    FILE_GRACE,
    STORY_TTL,
    StoryNotFoundError,
    normalize_story_text,
)

#: Tope de la lista de quienes vieron una historia.
VIEWS_LIMIT = 200


def _now():
    return datetime.now(timezone.utc)


def _author(row):
    return {
        "id": str(row["author_id"]),
        "username": row["author_username"],
        "name": row["author_name"],
        "avatar_url": media_url(row["author_avatar_path"]),
    }


#: Vida de la URL firmada de un archivo privado: la persona la pide cada vez que abre la historia.
PRIVATE_URL_TTL_SECONDS = 300


def story_file_url(key, private, status, private_storage):
    """URL del archivo de una historia, o `None` si no debe entregarse.

    * No aprobada -> `None`: solo quien la publicó llega a ver la fila, y sin URL.
    * Privada -> URL firmada y de vida corta. Sin almacenamiento privado configurado, `None`
      (falla cerrado: nunca se cae al bucket público).
    * Pública (historias anteriores) -> la URL pública de siempre."""
    if status != APPROVED:
        return None
    if private:
        if private_storage is None:
            return None
        return private_storage.signed_url(key, "image/webp", PRIVATE_URL_TTL_SECONDS)
    return media_url(key)


def present_story(row, include_seen=False, private_storage=None):
    """Forma pública de una historia. Nunca expone `storage_key`."""
    status = row.get("moderation_status", APPROVED)
    image = {
        "url": story_file_url(row["storage_key"], row.get("file_private", False), status, private_storage),
        "width": row["width"],
        "height": row["height"],
    }
    story = {
        "id": str(row["id"]),
        "author": _author(row),
        "content": row["content"],
        "image": image,
        "created_at": row["created_at"].isoformat(),
        "expires_at": row["expires_at"].isoformat(),
    }
    if status != APPROVED:
        # Solo la autora o el autor recibe una historia no aprobada (ver el repositorio).
        story["moderation_status"] = status
    if include_seen:
        story["seen_by_me"] = bool(row.get("seen_by_me"))
    return story


class PrivateStorageUnavailableError(Exception):
    """Se pidió guardar en el almacenamiento privado y no está configurado."""


def create_story(author_id, content, prepared_image, story_repository, media_storage, now=None,
                 private_storage=None, private_files=False):
    """`prepared_image`: `(bytes, content_type, ancho, alto)` ya validada y re-codificada.

    Primero el archivo y después la fila: si la base falla se borra el archivo, así que no
    queda nada a medias (mismo orden que las imágenes de las publicaciones, ADR-039).
    """
    text = normalize_story_text(content)
    now = now or _now()
    data, content_type, width, height = prepared_image
    key = f"stories/{uuid.uuid4()}.webp"

    # `private_files`: el archivo va al almacenamiento PRIVADO (nunca al público). Si se pidió y no
    # está disponible, se rechaza en vez de caer en el público (falla cerrado).
    if private_files and private_storage is None:
        raise PrivateStorageUnavailableError()
    store = private_storage if private_files else media_storage
    store.save(key, data, content_type)
    try:
        row = story_repository.create(
            author_id, text, key, width, height, now + STORY_TTL,
            moderation_status=initial_status(moderation_enabled()), file_private=private_files,
        )
    except Exception:
        discard_files([key], store)
        raise
    return present_story(row, include_seen=False, private_storage=private_storage)


def list_strip(viewer_id, story_repository, now=None, private_storage=None):
    """La tira del inicio: autores con historias vigentes que `viewer_id` puede ver."""
    rows = story_repository.strip_for(viewer_id, now or _now())
    return [
        {
            "author": {
                "id": str(row["author_id"]),
                "username": row["username"],
                "name": row["name"],
                "avatar_url": media_url(row["avatar_path"]),
            },
            "stories_count": row["stories_count"],
            "has_unseen": bool(row["has_unseen"]),
            "latest_at": row["latest_at"].isoformat(),
            "latest_image_url": story_file_url(
                row["latest_key"], row.get("latest_private", False),
                row.get("latest_status", APPROVED), private_storage,
            ),
            "is_me": str(row["author_id"]) == str(viewer_id),
        }
        for row in rows
    ]


def list_for_author(author_id, viewer_id, story_repository, now=None, private_storage=None):
    """Historias vigentes de una persona. Vacía si no existe, no tiene, o no puedes verlas:
    no se distingue, para no revelar que una cuenta privada existe (ADR-042 §2)."""
    rows = story_repository.list_for_author(author_id, viewer_id, now or _now())
    return [present_story(row, include_seen=True, private_storage=private_storage) for row in rows]


def _visible_story_or_404(story_id, viewer_id, story_repository, now):
    row = story_repository.get_active(story_id, now)
    if row is None or not story_repository.can_view(row["author_id"], viewer_id):
        raise StoryNotFoundError()
    # Moderación (ADR-044): una historia no aprobada solo existe para quien la publicó.
    if (
        moderation_enabled()
        and row["moderation_status"] != APPROVED
        and str(row["author_id"]) != str(viewer_id)
    ):
        raise StoryNotFoundError()
    return row


def record_view(story_id, viewer_id, story_repository, now=None):
    """Registra la vista. Idempotente. El autor viendo la suya no cuenta."""
    row = _visible_story_or_404(story_id, viewer_id, story_repository, now or _now())
    if str(row["author_id"]) != str(viewer_id):
        story_repository.add_view(story_id, viewer_id)
    return {"viewed": True}


def list_views(story_id, author_id, story_repository, now=None):
    """Solo la autora o el autor ve quién la vio; para cualquier otra persona es un 404."""
    row = story_repository.get_active(story_id, now or _now())
    if row is None or str(row["author_id"]) != str(author_id):
        raise StoryNotFoundError()
    views = story_repository.list_views(story_id, VIEWS_LIMIT)
    return {
        "views_count": story_repository.count_views(story_id),
        "views": [
            {
                "id": str(v["id"]),
                "username": v["username"],
                "name": v["name"],
                "avatar_url": media_url(v["avatar_path"]),
                "viewed_at": v["viewed_at"].isoformat(),
            }
            for v in views
        ],
    }


def _discard(files, media_storage, private_storage):
    """Borra cada archivo de SU almacenamiento: los privados no están en el público."""
    discard_files([k for k, private in files if not private], media_storage)
    private_keys = [k for k, private in files if private]
    if private_keys and private_storage is not None:
        discard_files(private_keys, private_storage)


def delete_story(story_id, author_id, story_repository, media_storage, private_storage=None):
    deleted = story_repository.delete(story_id, author_id)
    if deleted is None:
        # Mismo error si no existe o es de otra persona (ADR-019 §Seguridad).
        raise StoryNotFoundError()
    _discard([deleted], media_storage, private_storage)
    return {"deleted": True}


def purge_expired_stories(story_repository, media_storage, now=None, private_storage=None):
    """Borra filas y archivos de historias vencidas hace más de `FILE_GRACE`. Devuelve el
    número de historias borradas. Lo llama `scripts/purge_expired_data.py`."""
    files = story_repository.purge_expired((now or _now()) - FILE_GRACE)
    _discard(files, media_storage, private_storage)
    return len(files)
