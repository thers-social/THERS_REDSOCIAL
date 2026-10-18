# Adjuntos de un mensaje recién creado (imagen ADR-039, nota de voz ADR-042, video ADR-046). Los usan el
# mensaje directo y el de grupo (ADR-048): mismo criterio, un solo sitio.

from app.application.media.attachments import discard_files, store_attachments, store_video, store_voice


def attach_media(
    message, sender_id, message_repository, media_repository, media_storage, audio_repository,
    video_repository, prepared_images=None, prepared_audio=None, prepared_video=None,
):
    """Guarda los adjuntos de un mensaje NUEVO. Si algo falla se retira el mensaje entero (y los
    archivos ya guardados) para que quien envía pueda reintentar. Llamar solo cuando `created`."""
    if prepared_images:
        stored = []
        try:
            stored = store_attachments(prepared_images, "message", media_storage)
            media_repository.add_for_message(message.id, sender_id, stored)
        except Exception:
            discard_files([item["key"] for item in stored], media_storage)
            message_repository.delete(message.id, sender_id)
            raise

    if prepared_audio:
        stored_voice = None
        try:
            stored_voice = store_voice(prepared_audio, media_storage)
            audio_repository.add_for_message(message.id, sender_id, stored_voice)
        except Exception:
            if stored_voice is not None:
                discard_files([stored_voice["key"]], media_storage)
            message_repository.delete(message.id, sender_id)
            raise

    if prepared_video:
        stored_video = None
        try:
            stored_video = store_video(prepared_video, media_storage)
            video_repository.add_for_message(message.id, sender_id, stored_video)
        except Exception:
            if stored_video is not None:
                discard_files([stored_video["key"], stored_video["thumb_key"]], media_storage)
            message_repository.delete(message.id, sender_id)
            raise
