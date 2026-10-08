# Caso de uso: borrar un mensaje propio (DELETE /api/messages/<message_id>,
# ADR-014-messages-ux-improvements.md). `sender_id` viene exclusivamente de
# get_jwt_identity() en la route -- solo se puede borrar un mensaje que uno
# mismo mandó.

from app.application.media.attachments import discard_files
from app.domain.messages.exceptions import MessageNotFoundError


def delete_message(
    message_id, sender_id, message_repository, media_repository=None, media_storage=None
):
    # Claves leídas antes de borrar (el borrado en cascada elimina las filas),
    # filtradas por dueño: ver delete_post_use_case.py (ADR-039).
    keys = media_repository.keys_for_message(message_id, sender_id) if media_repository else []

    deleted = message_repository.delete(message_id, sender_id)
    if deleted:
        discard_files(keys, media_storage)
    if not deleted:
        raise MessageNotFoundError()
    return {"deleted": True}
