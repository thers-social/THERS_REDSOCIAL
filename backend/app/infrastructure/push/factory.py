# Crea el notificador push según la configuración (ADR-053). Devuelve `None` (sin push) si está
# apagado, si faltan credenciales o si son inválidas: nunca impide que la API arranque.

import json
import logging
import sys

from app.infrastructure.persistence.repositories.group_repository import SQLAlchemyGroupRepository
from app.infrastructure.persistence.repositories.push_device_repository import (
    SQLAlchemyPushDeviceRepository,
)
from app.infrastructure.persistence.repositories.restriction_repository import (
    SQLAlchemyRestrictionRepository,
)
from app.infrastructure.persistence.repositories.user_repository import SQLAlchemyUserRepository
from app.infrastructure.push.fcm_client import FcmClient
from app.infrastructure.push.notifier import PushNotifier

logger = logging.getLogger(__name__)


def _service_account(config):
    inline = config.get("FCM_SERVICE_ACCOUNT_JSON")
    if inline:
        return json.loads(inline)
    path = config.get("FCM_SERVICE_ACCOUNT_FILE")
    if path:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    return None


def build_push_notifier(app):
    if not app.config.get("PUSH_ENABLED"):
        return None
    try:
        info = _service_account(app.config)
        if info is None:
            print(
                "[config] PUSH_ENABLED está activo pero faltan FCM_SERVICE_ACCOUNT_FILE / "
                "FCM_SERVICE_ACCOUNT_JSON: no se enviarán notificaciones push.",
                file=sys.stderr,
            )
            return None
        client = FcmClient(info)
    except Exception:  # noqa: BLE001 -- credenciales ilegibles: la API arranca igual, sin push
        logger.exception("No se pudo iniciar Firebase; el push queda apagado")
        return None
    return PushNotifier(
        app, client, SQLAlchemyPushDeviceRepository(), SQLAlchemyUserRepository(),
        SQLAlchemyGroupRepository(), SQLAlchemyRestrictionRepository(),
    )
