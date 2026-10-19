# Qué dice cada notificación push (ADR-053). Funciones PURAS: sin Flask ni base de datos.
#
# Los textos son lo que aparece en la pantalla de bloqueo, así que se acotan: un mensaje muestra una
# vista previa corta (como Instagram) y los adjuntos se nombran sin enviarlos. Todo valor de `data` es
# texto, porque FCM solo admite cadenas.

MAX_BODY = 90

TYPE_LIKE = "like"
TYPE_COMMENT = "comment"
TYPE_FOLLOW = "follow"
TYPE_FOLLOW_REQUEST = "follow_request"
TYPE_FOLLOW_ACCEPTED = "follow_accepted"
TYPE_MENTION = "mention"
TYPE_MESSAGE = "message"
TYPE_GROUP_MESSAGE = "group_message"


def _clip(text, limit=MAX_BODY):
    text = " ".join((text or "").split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def message_preview(content, has_image=False, has_audio=False, has_video=False, has_place=False, has_post=False):
    """Vista previa del mensaje para la notificación: su texto, o el nombre del adjunto."""
    text = _clip(content)
    if text:
        return text
    if has_image:
        return "📷 Foto"
    if has_video:
        return "🎬 Video"
    if has_audio:
        return "🎤 Nota de voz"
    if has_place:
        return "📍 Te compartió un lugar"
    if has_post:
        return "Te compartió una publicación"
    return "Nuevo mensaje"


def notification_payload(notification_type, actor_username, post_id=None):
    """`(title, body, data)` de una notificación de la app, o `None` si ese tipo no se envía por push."""
    who = f"@{actor_username}" if actor_username else "Alguien"
    data = {"type": notification_type}
    if post_id:
        data["post_id"] = str(post_id)
    if notification_type == TYPE_LIKE:
        return "THERS", f"A {who} le gustó tu publicación", data
    if notification_type == TYPE_COMMENT:
        return "THERS", f"{who} comentó tu publicación", data
    if notification_type == TYPE_FOLLOW:
        return "THERS", f"{who} empezó a seguirte", data
    if notification_type == TYPE_FOLLOW_REQUEST:
        return "THERS", f"{who} quiere seguirte", data
    if notification_type == TYPE_FOLLOW_ACCEPTED:
        return "THERS", f"{who} aceptó tu solicitud", data
    if notification_type == TYPE_MENTION:
        return "THERS", f"{who} te mencionó", data
    return None


_RESERVATION_STATE = {"confirmed": "Confirmó tu reserva", "declined": "Rechazó tu reserva"}
_QUOTE_STATE = {"accepted": "Aceptó tu cotización", "rejected": "Rechazó tu cotización"}
_CLAIM_STATE = {
    "approved": "Aprobó tu reclamo: ya puedes administrar el negocio",
    "rejected": "Rechazó tu reclamo",
}


def place_notice_payload(notification_type, detail, place_name, place_id, object_id=None):
    """`(title, body, data)` de un aviso de THERS Places (ADR-040 fase 12), o `None` si el tipo no es de Places.

    El título es el nombre del lugar; el cuerpo, la acción. Nunca lleva texto libre de nadie (el aviso
    tampoco lo guarda). `data` solo lleva identificadores, para que la app abra la pantalla correcta."""
    body = {
        "place_reservation_new": "Nueva solicitud de reserva",
        "place_reservation_cancelled": "Una reserva fue cancelada por el cliente",
        "place_quote_new": "Nueva solicitud de cotización",
        "place_plan_invite": "Te invitó a un plan",
        "place_review_reply": "Respondió a tu reseña",
    }.get(notification_type)
    if body is None:
        if notification_type == "place_reservation_decided":
            body = _RESERVATION_STATE.get(detail, "Actualizó tu reserva")
        elif notification_type == "place_quote_decided":
            body = _QUOTE_STATE.get(detail, "Respondió tu cotización")
        elif notification_type == "place_claim_decided":
            body = _CLAIM_STATE.get(detail, "Respondió a tu reclamo")
        else:
            return None
    data = {"type": notification_type, "place_id": str(place_id)}
    if object_id:
        data["object_id"] = str(object_id)
    return _clip(place_name or "THERS Places", 60), body, data


def direct_message_payload(sender_id, sender_name, preview):
    return sender_name, preview, {"type": TYPE_MESSAGE, "sender_id": str(sender_id)}


def group_message_payload(group_id, group_name, sender_name, preview):
    return (
        group_name,
        f"{sender_name}: {preview}",
        {"type": TYPE_GROUP_MESSAGE, "group_id": str(group_id)},
    )
