# Caso de uso: listar las conversaciones del usuario autenticado
# (GET /api/conversations, ADR-013-messages-minimal-model.md). Es lo que
# alimenta Messages.jsx (lista de conversaciones) y el badge de no-leídos
# de Sidebar/Topbar (sumando `unread_count` de cada una).

from app.application.messages.message_presenter import to_public_conversation


def list_conversations(user_id, message_repository, restriction_repository):
    conversations = message_repository.list_conversations(user_id)

    # Las conversaciones con una cuenta bloqueada (en cualquier sentido) no se
    # listan, y por consiguiente no suman al badge de no leídos (ADR-029).
    # Se filtra acá y no en SQL: la lista ya está reducida a una fila por
    # conversación, y el conjunto de bloqueados es chico.
    blocked_ids = restriction_repository.blocked_ids_either_way(user_id)
    return [
        to_public_conversation(conversation, viewer_id=user_id)
        for conversation in conversations
        if str(conversation["other_user"].id) not in blocked_ids
    ]
