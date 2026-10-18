# Caso de uso: ver el historial de mensajes con otro usuario
# (GET /api/users/<user_id>/messages, ADR-013-messages-minimal-model.md).
# Efecto secundario a propósito: marca como leídos los mensajes que
# `other_user_id` le mandó a `user_id` (ADR-013 §Opciones consideradas --
# "abrir el hilo" es "leerlo", no hay un PATCH separado).

from app.application.messages.message_presenter import to_public_messages
from app.domain.auth.exceptions import UserNotFoundError

DEFAULT_LIMIT = 50


def list_thread(
    user_id, other_user_id, user_repository, message_repository, restriction_repository,
    limit=DEFAULT_LIMIT, before=None, after=None,
):
    """Devuelve `(mensajes_públicos, has_more)` (ADR-035: paginación y recuperación)."""
    other_user = user_repository.find_by_id(other_user_id)
    if other_user is None:
        raise UserNotFoundError()

    # Con un bloqueo en cualquier sentido el hilo deja de ser accesible
    # (ADR-029). Los mensajes no se borran: reaparecen si se desbloquea.
    if restriction_repository.is_blocked_between(user_id, other_user_id):
        raise UserNotFoundError()

    messages, has_more = message_repository.list_thread_page(
        user_id, other_user_id, limit, before=before, after=after
    )

    # El objeto público se arma ANTES de marcar como leído
    # (ADR-014-messages-ux-improvements.md §Decisión): Flask-SQLAlchemy
    # expira los objetos del `session` tras un `commit()` (comportamiento
    # por defecto), así que si `mark_thread_as_read` corriera primero, el
    # próximo acceso a `message.read_at` -- dentro de `to_public_message`,
    # más abajo -- dispararía una relectura y ya devolvería el valor
    # actualizado, dejando `read` siempre en `true` incluso para los
    # mensajes que esta misma llamada acaba de marcar. Armando la respuesta
    # primero, el Frontend recibe el estado real de "antes de abrir el
    # hilo" y puede ubicar el separador de "mensajes no leídos".
    public_messages = to_public_messages(messages, message_repository, viewer_id=user_id)

    message_repository.mark_thread_as_read(recipient_id=user_id, sender_id=other_user_id)

    return public_messages, has_more
