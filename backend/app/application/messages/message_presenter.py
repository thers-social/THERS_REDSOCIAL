# Forma pública del objeto `message` devuelto por POST/GET
# /api/users/<id>/messages (ADR-013-messages-minimal-model.md §Contrato) --
# centralizada acá para no duplicarla, mismo patrón que
# application/notifications/notification_presenter.py.


from app.application.auth.user_presenter import to_author_summary
from app.application.media.attachments import to_public_images


def to_public_message(message):
    return {
        "id": str(message.id),
        "sender_id": str(message.sender_id),
        "recipient_id": str(message.recipient_id),
        "content": message.content,
        # Imagen adjunta (ADR-039): `[]` si no tiene.
        "images": to_public_images(message.images),
        # Se expone como booleano, nunca como el timestamp `read_at` crudo
        # -- mismo criterio que `notifications.read` (ADR-008).
        "read": message.read_at is not None,
        "created_at": message.created_at.isoformat(),
        # Booleano, nunca el timestamp `edited_at` crudo -- mismo criterio
        # que `read` en messages/notifications (ADR-021-content-editing.md).
        "edited": message.edited_at is not None,
        # ADR-035: el id que eligió quien envió (null si su cliente no lo manda).
        "client_id": message.client_id,
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
            "sender_id": str(last_message.sender_id),
            "created_at": last_message.created_at.isoformat(),
        },
        "unread_count": conversation["unread_count"],
    }
