# Forma pública del objeto `message` devuelto por POST/GET
# /api/users/<id>/messages (ADR-013-messages-minimal-model.md §Contrato) --
# centralizada acá para no duplicarla, mismo patrón que
# application/notifications/notification_presenter.py.


from app.application.auth.user_presenter import to_author_summary
from app.application.media.attachments import to_public_audio, to_public_images, to_public_video
from app.application.places.place_card import to_place_card
from app.application.posts.post_card import to_post_card


def _place_card(message, place_cards):
    """Tarjeta del lugar compartido (ADR-040 fase 4c), o None si no es un mensaje de lugar.
    Un lugar que ya no es público se muestra como no disponible: solo su id, nunca nombre
    ni ubicación (la ficha podría haberse retirado por una razón de moderación)."""
    return to_place_card(message.place_id, place_cards)


def to_public_messages(messages, message_repository, viewer_id=None, group_last_read=None):
    """Varios mensajes con las tarjetas de lugar y de publicación resueltas en UNA consulta cada una.
    `viewer_id` es quien mira: la tarjeta de una publicación depende de si esa persona puede verla."""
    cards = message_repository.place_cards([m.place_id for m in messages if m.place_id])
    post_ids = [m.post_id for m in messages if m.post_id]
    posts = message_repository.visible_posts(post_ids, viewer_id) if post_ids else {}
    return [
        to_public_message(message, cards, posts, viewer_id, group_last_read)
        for message in messages
    ]


def _group_read(message, viewer_id, group_last_read):
    """En un grupo `read` es relativo a quien mira: lo propio cuenta como leído, y lo ajeno es leído si
    es anterior a la última vez que esa persona abrió el grupo (ADR-048)."""
    if str(message.sender_id) == str(viewer_id) or group_last_read is None:
        return True
    return message.created_at <= group_last_read


def to_public_message(
    message, place_cards=None, visible_posts=None, viewer_id=None, group_last_read=None
):
    in_group = message.group_id is not None
    return {
        "id": str(message.id),
        "sender_id": str(message.sender_id),
        # Un mensaje de grupo no tiene destinatario único (ADR-048).
        "recipient_id": str(message.recipient_id) if message.recipient_id else None,
        "group_id": str(message.group_id) if in_group else None,
        # Quién lo escribió: en un grupo hace falta para pintar el nombre; en un directo es redundante.
        "sender": to_author_summary(message.sender) if in_group else None,
        "content": message.content,
        # Imagen adjunta (ADR-039): `[]` si no tiene.
        "images": to_public_images(message.images),
        # Nota de voz (ADR-042): `null` si no tiene.
        "audio": to_public_audio(message.audio),
        # Video corto (ADR-046): `null` si no tiene.
        "video": to_public_video(message.video),
        # Se expone como booleano, nunca como el timestamp `read_at` crudo
        # -- mismo criterio que `notifications.read` (ADR-008).
        "read": (
            _group_read(message, viewer_id, group_last_read)
            if in_group
            else message.read_at is not None
        ),
        "created_at": message.created_at.isoformat(),
        # Booleano, nunca el timestamp `edited_at` crudo -- mismo criterio
        # que `read` en messages/notifications (ADR-021-content-editing.md).
        "edited": message.edited_at is not None,
        # ADR-035: el id que eligió quien envió (null si su cliente no lo manda).
        "client_id": message.client_id,
        # ADR-040 fase 4c: tarjeta del lugar compartido (null en un mensaje normal).
        "place": _place_card(message, place_cards),
        # ADR-047: tarjeta de la publicación compartida (null en un mensaje normal). Depende de quién mira.
        "post": to_post_card(message.post_id, visible_posts, viewer_id),
    }


def to_public_conversation(conversation):
    other_user = conversation["other_user"]
    last_message = conversation["last_message"]
    return {
        "user": {
            **to_author_summary(other_user),
            # Estado de actividad (ADR-024-content-filters-and-privacy-preferences.md).
            # `null` si la otra persona lo tiene oculto O si nunca registró
            # actividad -- los dos casos son indistinguibles a propósito: si
            # solo se omitiera cuando está oculto, el propio hecho de faltar
            # delataría que alguien lo apagó (ADR-024 §Seguridad).
            #
            # Acá SÍ viaja el timestamp, a diferencia de `read`/`edited` que se
            # exponen como booleanos: "activo hace 3 horas" necesita la hora,
            # y un booleano "está activo" obligaría al servidor a decidir el
            # umbral en vez del Frontend.
            "last_seen_at": (
                other_user.last_seen_at.isoformat()
                if other_user.show_activity_status and other_user.last_seen_at
                else None
            ),
        },
        "last_message": {
            "content": last_message.content,
            # Un mensaje de solo imagen tiene `content` vacío: la lista de
            # conversaciones necesita saberlo para mostrar "Foto" (ADR-039).
            "has_image": bool(last_message.images),
            # Lo mismo para la nota de voz: la lista muestra "Nota de voz" (ADR-042).
            "has_audio": last_message.audio is not None,
            # Y para el video: la lista muestra «Video» (ADR-046).
            "has_video": last_message.video is not None,
            # Un mensaje que comparte un lugar puede no llevar texto (ADR-040 fase 4c).
            "has_place": last_message.place_id is not None,
            # Y una publicación compartida (ADR-047).
            "has_post": last_message.post_id is not None,
            "sender_id": str(last_message.sender_id),
            "created_at": last_message.created_at.isoformat(),
        },
        "unread_count": conversation["unread_count"],
    }
