# Punto único por el que los casos de uso piden una notificación push (ADR-053).
#
# Los casos de uso NO conocen Firebase ni hilos: llaman a estas funciones, que reenvían al `notifier`
# registrado al arrancar (`app/__init__.py`). Sin notifier (push apagado, pruebas) no hacen nada, y un
# fallo al notificar NUNCA rompe la acción que lo originó: el push es un extra, no parte del contrato.

import logging

logger = logging.getLogger(__name__)

_notifier = None


def set_notifier(notifier):
    global _notifier
    _notifier = notifier


def get_notifier():
    return _notifier


def _emit(method, *args, **kwargs):
    if _notifier is None:
        return
    try:
        getattr(_notifier, method)(*args, **kwargs)
    except Exception:  # noqa: BLE001 -- el push nunca rompe la operación
        logger.exception("push %s failed", method)


def notification_created(recipient_id, actor_id, notification_type, post_id=None):
    _emit("notification_created", recipient_id, actor_id, notification_type, post_id)


def place_notice_created(recipient_ids, notification_type, detail, place_id, place_name, object_id):
    _emit("place_notice_created", recipient_ids, notification_type, detail, place_id, place_name, object_id)


def direct_message_sent(sender_id, recipient_id, preview):
    _emit("direct_message_sent", sender_id, recipient_id, preview)


def group_message_sent(sender_id, group_id, preview):
    _emit("group_message_sent", sender_id, group_id, preview)
