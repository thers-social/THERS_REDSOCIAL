# Cliente de Firebase Cloud Messaging (HTTP v1) para el envío de notificaciones push (ADR-053).
#
# Autenticación con una cuenta de servicio de Firebase (JSON, solo en el servidor, nunca en el
# repositorio ni en el móvil): se firma un token OAuth2 de corta vida con `google-auth`, que ya es
# dependencia del proyecto (inicio de sesión con Google, ADR-012). Sin credenciales no se crea cliente.

import json
import logging

import requests
from google.auth.transport.requests import Request
from google.oauth2 import service_account

logger = logging.getLogger(__name__)

SCOPE = "https://www.googleapis.com/auth/firebase.messaging"
OK, INVALID_TOKEN, FAILED = "ok", "invalid_token", "failed"


class FcmClient:
    def __init__(self, service_account_info, timeout=8.0, session=None):
        self._credentials = service_account.Credentials.from_service_account_info(
            service_account_info, scopes=[SCOPE]
        )
        self._project_id = service_account_info["project_id"]
        self._timeout = timeout
        self._session = session or requests.Session()

    def _access_token(self):
        if not self._credentials.valid:
            self._credentials.refresh(Request())
        return self._credentials.token

    def send(self, token, title, body, data):
        """Envía a UN dispositivo. Devuelve `ok`, `invalid_token` (borrarlo) o `failed` (reintentable)."""
        message = {
            "message": {
                "token": token,
                "notification": {"title": title, "body": body},
                "data": {str(k): str(v) for k, v in data.items()},
                "android": {"priority": "HIGH", "notification": {"channel_id": "default"}},
            }
        }
        try:
            response = self._session.post(
                f"https://fcm.googleapis.com/v1/projects/{self._project_id}/messages:send",
                headers={"Authorization": f"Bearer {self._access_token()}"},
                data=json.dumps(message),
                timeout=self._timeout,
            )
        except Exception:  # noqa: BLE001 -- red, credenciales...: nunca sale al llamador
            logger.exception("FCM request failed")
            return FAILED
        if response.status_code == 200:
            return OK
        # 404 UNREGISTERED o 400 INVALID_ARGUMENT sobre el token: ese dispositivo ya no existe.
        if response.status_code in (400, 404):
            text = response.text or ""
            if "UNREGISTERED" in text or "INVALID_ARGUMENT" in text or response.status_code == 404:
                return INVALID_TOKEN
        logger.warning("FCM answered %s", response.status_code)
        return FAILED
