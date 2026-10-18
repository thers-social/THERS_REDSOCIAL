# Notificador push (ADR-053): arma el texto de cada aviso, busca los dispositivos de quien lo recibe y
# lo envía por Firebase.
#
# La parte que necesita la base de datos (nombres, dispositivos, miembros de un grupo) se resuelve en el
# hilo de la petición, que ya tiene contexto de aplicación. Solo la llamada de red a Firebase corre en un
# hilo aparte, para que enviar un mensaje o dar un like no espere a un tercero. Con `sync=True` (pruebas)
# todo corre en línea.

import logging
import threading

from app.domain.push import payloads
from app.infrastructure.push.fcm_client import INVALID_TOKEN

logger = logging.getLogger(__name__)


class PushNotifier:
    def __init__(
        self, app, client, device_repository, user_repository, group_repository,
        restriction_repository, sync=False,
    ):
        self._app = app
        self._client = client
        self._devices = device_repository
        self._users = user_repository
        self._groups = group_repository
        self._restrictions = restriction_repository
        self._sync = sync

    # ---------------------------------------------------------------- eventos

    def notification_created(self, recipient_id, actor_id, notification_type, post_id=None):
        actor = self._users.find_by_id(actor_id) if actor_id else None
        payload = payloads.notification_payload(
            notification_type, actor.username if actor else None, post_id
        )
        if payload is None:
            return
        data = dict(payload[2])
        if actor is not None:
            data["actor_id"] = str(actor.id)
        self._deliver([recipient_id], (payload[0], payload[1], data))

    def direct_message_sent(self, sender_id, recipient_id, preview):
        sender = self._users.find_by_id(sender_id)
        if sender is None:
            return
        self._deliver(
            [recipient_id], payloads.direct_message_payload(sender.id, sender.name, preview)
        )

    def group_message_sent(self, sender_id, group_id, preview):
        sender = self._users.find_by_id(sender_id)
        group = self._groups.get(group_id)
        if sender is None or group is None:
            return
        blocked = self._restrictions.blocked_ids_either_way(sender_id)
        recipients = [
            member.user_id
            for member in self._groups.members(group_id)
            if str(member.user_id) != str(sender_id) and str(member.user_id) not in blocked
        ]
        self._deliver(
            recipients, payloads.group_message_payload(group.id, group.name, sender.name, preview)
        )

    # ---------------------------------------------------------------- envío

    def _deliver(self, recipient_ids, payload):
        tokens = [t for ts in self._devices.tokens_for_users(recipient_ids).values() for t in ts]
        if not tokens:
            return
        title, body, data = payload
        if self._sync:
            self._send_all(tokens, title, body, data)
            return
        threading.Thread(
            target=self._send_in_background, args=(tokens, title, body, data), daemon=True
        ).start()

    def _send_in_background(self, tokens, title, body, data):
        with self._app.app_context():
            self._send_all(tokens, title, body, data)

    def _send_all(self, tokens, title, body, data):
        dead = []
        for token in tokens:
            try:
                if self._client.send(token, title, body, data) == INVALID_TOKEN:
                    dead.append(token)
            except Exception:  # noqa: BLE001 -- un dispositivo roto no frena a los demás
                logger.exception("push send failed")
        if dead:
            self._devices.remove_tokens(dead)
