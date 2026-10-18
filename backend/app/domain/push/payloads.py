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


def direct_message_payload(sender_id, sender_name, preview):
    return sender_name, preview, {"type": TYPE_MESSAGE, "sender_id": str(sender_id)}


def group_message_payload(group_id, group_name, sender_name, preview):
    return (
        group_name,
        f"{sender_name}: {preview}",
        {"type": TYPE_GROUP_MESSAGE, "group_id": str(group_id)},
    )
