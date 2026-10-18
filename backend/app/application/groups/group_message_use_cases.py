# Mensajes de un chat grupal (ADR-048): enviar y leer. Reutilizan el presentador y los adjuntos de los
# mensajes directos; lo propio del grupo es la pertenencia y el "leído" por miembro.

from app.application.messages.message_media import attach_media
from app.application.messages.message_presenter import to_public_messages
from app.application.push import events as push_events
from app.application.push.preview import message_preview_of
from app.domain.groups.exceptions import GroupNotFoundError
from app.domain.messages.exceptions import SharedPlaceNotFoundError, SharedPostNotFoundError


def send_group_message(
    group_id, sender_id, content, group_repository, message_repository, client_id=None,
    prepared_images=None, media_repository=None, media_storage=None, place_id=None,
    prepared_audio=None, audio_repository=None, prepared_video=None, video_repository=None,
    post_id=None,
):
    """Devuelve `(mensaje_público, created)`. Solo escribe quien es miembro; quien no lo es recibe el
    mismo `GroupNotFoundError` que si el grupo no existiera."""
    if group_repository.membership(group_id, sender_id) is None:
        raise GroupNotFoundError()

    if place_id is not None and not message_repository.place_cards([place_id]):
        raise SharedPlaceNotFoundError()
    # Solo publicaciones que QUIEN COMPARTE puede ver (ADR-047): un grupo no filtra una cuenta privada.
    if post_id is not None and not message_repository.visible_posts([post_id], sender_id):
        raise SharedPostNotFoundError()

    if client_id is None:
        message = message_repository.create(
            sender_id, None, content, place_id=place_id, post_id=post_id, group_id=group_id
        )
        created = True
    else:
        message, created = message_repository.create_idempotent(
            sender_id, None, content, client_id, place_id=place_id, post_id=post_id,
            group_id=group_id,
        )

    if created:
        attach_media(
            message, sender_id, message_repository, media_repository, media_storage,
            audio_repository, video_repository, prepared_images=prepared_images,
            prepared_audio=prepared_audio, prepared_video=prepared_video,
        )
        # Quien escribe ya "leyó" hasta aquí: no se cuenta sus propios mensajes como no leídos.
        group_repository.mark_read(group_id, sender_id)

    public = to_public_messages([message], message_repository, sender_id)[0]
    if created:
        push_events.group_message_sent(sender_id, group_id, message_preview_of(public))
    return public, created


def list_group_thread(
    group_id, user_id, group_repository, message_repository, restriction_repository, limit,
    before=None, after=None,
):
    """Devuelve `(mensajes_públicos, has_more)`. Abrir el grupo lo marca leído para quien lo abre. Los
    mensajes de cuentas bloqueadas (en cualquier sentido) no se muestran (ADR-029); reaparecen si se
    desbloquea."""
    me = group_repository.membership(group_id, user_id)
    if me is None:
        raise GroupNotFoundError()

    hidden = restriction_repository.blocked_ids_either_way(user_id)
    messages, has_more = group_repository.list_messages_page(
        group_id, limit, hidden, before=before, after=after
    )
    # Se arma ANTES de marcar leído (mismo motivo que list_thread, ADR-014): `read` refleja el estado
    # previo a abrir, para poder ubicar el separador de no leídos.
    public = to_public_messages(messages, message_repository, user_id, group_last_read=me.last_read_at)
    group_repository.mark_read(group_id, user_id)
    return public, has_more
