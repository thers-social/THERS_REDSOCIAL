# Caso de uso: editar un mensaje propio (PATCH /api/messages/<message_id>,
# ADR-021-content-editing.md). `sender_id` viene exclusivamente de
# get_jwt_identity() en la route; `content` ya llega validado en formato por
# la route (domain/messages/validators.py, mismo validador que mandar un
# mensaje) -- mismo patrón que delete_message_use_case.py (ADR-014).

from app.application.messages.message_presenter import to_public_messages
from app.domain.messages.exceptions import MessageNotFoundError


def update_message(message_id, sender_id, content, message_repository):
    message = message_repository.update_content(message_id, sender_id, content)
    if message is None:
        raise MessageNotFoundError()

    # `read` no se toca: editar un mensaje que la otra persona ya leyó no lo
    # devuelve a no leído (ADR-021 §Decisión) -- el separador de "mensajes no
    # leídos" de Messages.jsx no debe reordenarse porque alguien corrigió una
    # palabra.
    return to_public_messages([message], message_repository)[0]
