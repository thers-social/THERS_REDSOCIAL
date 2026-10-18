# Vista previa de un mensaje YA presentado (la forma pública de la API) para la notificación push
# (ADR-053). Solo mira el texto y qué adjuntos trae; nunca incluye URLs ni archivos.

from app.domain.push.payloads import message_preview


def message_preview_of(public_message):
    return message_preview(
        public_message.get("content"),
        has_image=bool(public_message.get("images")),
        has_audio=public_message.get("audio") is not None,
        has_video=public_message.get("video") is not None,
        has_place=public_message.get("place") is not None,
        has_post=public_message.get("post") is not None,
    )
