# Casos de uso compartidos de imágenes adjuntas (ADR-039): guardar los archivos
# ya procesados, limpiarlos si algo falla y presentarlos al cliente.
#
# El procesamiento (decodificar, quitar EXIF, reducir, WebP) lo hace la route
# con `process_attachment` ANTES de llamar a un caso de uso, para que una imagen
# inválida falle con 400 antes de tocar nada. Aquí solo se guarda.

import logging
import uuid

from app.application.media.media_url import media_url

_logger = logging.getLogger(__name__)


def store_attachments(prepared, kind, storage):
    """Guarda cada imagen procesada con un nombre aleatorio impredecible y
    devuelve `[{"key", "width", "height"}]`. Si alguna falla, borra las que ya
    se habían guardado y vuelve a lanzar el error: nunca quedan archivos a medias.

    `prepared`: lista de `(bytes, content_type, width, height)`.
    """
    stored = []
    try:
        for data, content_type, width, height in prepared:
            key = f"{kind}s/{uuid.uuid4().hex}.webp"
            storage.save(key, data, content_type)
            stored.append({"key": key, "width": width, "height": height})
    except Exception:
        discard_files([item["key"] for item in stored], storage)
        raise
    return stored


def store_voice(prepared, storage):
    """Guarda una nota de voz ya procesada (ADR-042) con un nombre aleatorio impredecible y
    devuelve `{"key", "duration_ms", "size_bytes"}`. `prepared`: `(bytes, content_type, duration_ms)`."""
    data, content_type, duration_ms = prepared
    key = f"voice/{uuid.uuid4().hex}.m4a"
    storage.save(key, data, content_type)
    return {"key": key, "duration_ms": duration_ms, "size_bytes": len(data)}


def to_public_audio(audio):
    """Forma pública de la nota de voz de un mensaje, o `None`. Solo la URL y la duración que
    calculó el servidor: nunca la clave interna ni quién la subió."""
    if audio is None:
        return None
    return {"url": media_url(audio.storage_key), "duration_ms": audio.duration_ms}


def discard_files(keys, storage):
    """Borra archivos del almacenamiento sin fallar: es limpieza, y un archivo
    huérfano (nombre aleatorio, sin datos personales) es preferible a perder la
    respuesta. Se deja registrado para poder barrerlo."""
    for key in keys:
        try:
            storage.delete(key)
        except Exception:  # noqa: BLE001 -- limpieza best-effort
            _logger.warning("Archivo huérfano en el almacenamiento: %s", key)


def to_public_images(images):
    """Forma pública de las imágenes de un post/mensaje. Nunca expone la clave
    interna ni quién la subió: solo la URL y las dimensiones, que el cliente
    necesita para reservar el espacio y evitar saltos de diseño."""
    return [
        {"url": media_url(image.storage_key), "width": image.width, "height": image.height}
        for image in (images or [])
    ]
