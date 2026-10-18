# Cliente de n8n (ADR-041 §7). ÚNICO archivo del backend que habla con n8n. Sin dependencias nuevas:
# usa `urllib`, igual que el adaptador de rutas.
#
# Qué garantiza:
#   · cada envío va FIRMADO (HMAC-SHA256 con `N8N_WEBHOOK_SECRET`) y con una clave de idempotencia
#     estable, para que n8n reconozca un reintento;
#   · tiempo máximo por intento y reintentos acotados, con espera creciente; solo se reintenta lo
#     transitorio (red, tiempo agotado, 5xx, 408 y 429). Un 4xx es un rechazo definitivo;
#   · el secreto nunca se registra, ni el cuerpo enviado, ni la respuesta: pueden llevar datos de
#     personas. Al log solo va el tipo de evento, el resultado y el número de intentos.

import json
import logging
import time
import urllib.error
import urllib.request
from urllib.parse import urlparse

from app.domain.automations import signing
from app.domain.automations.client import AutomationClient, AutomationDeliveryError

logger = logging.getLogger(__name__)

_RETRYABLE_STATUS = (408, 429)


def webhook_path(event_type):
    """`report_resolved` -> `/webhook/thers-report-resolved` (la ruta del nodo Webhook de n8n)."""
    return "/webhook/thers-" + event_type.replace("_", "-")


class N8nClient(AutomationClient):
    name = "n8n"

    def __init__(
        self, base_url, secret, timeout_seconds=5.0, max_retries=2,
        opener=None, sleep=time.sleep, clock=time.time,
    ):
        parsed = urlparse(base_url or "")
        # Solo http(s): una URL `file:` o similar convertiría esto en lectura de archivos locales.
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise ValueError("N8N_BASE_URL debe ser una URL http(s)")
        if not secret:
            raise ValueError("N8N_WEBHOOK_SECRET es obligatorio")
        self._base_url = base_url.rstrip("/")
        self._secret = secret
        self._timeout = timeout_seconds
        self._max_retries = max(0, int(max_retries))
        self._open = opener or urllib.request.urlopen
        self._sleep = sleep
        self._clock = clock

    def send(self, event_type, payload, idempotency_key):
        body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        url = self._base_url + webhook_path(event_type)
        attempts = 1 + self._max_retries

        for attempt in range(1, attempts + 1):
            # Marca de tiempo NUEVA en cada intento: un reintento tardío no caduca por la anterior.
            timestamp = int(self._clock())
            request = urllib.request.Request(
                url,
                data=body,
                method="POST",
                headers={
                    "Content-Type": "application/json",
                    signing.TIMESTAMP_HEADER: str(timestamp),
                    signing.SIGNATURE_HEADER: signing.sign(self._secret, timestamp, body),
                    signing.IDEMPOTENCY_HEADER: idempotency_key,
                },
            )
            retryable = True
            try:
                with self._open(request, timeout=self._timeout) as response:
                    if 200 <= response.status < 300:
                        logger.info("n8n evento=%s resultado=ok intentos=%d", event_type, attempt)
                        return True
                    retryable = response.status >= 500 or response.status in _RETRYABLE_STATUS
            except urllib.error.HTTPError as error:
                retryable = error.code >= 500 or error.code in _RETRYABLE_STATUS
                if not retryable:
                    logger.warning("n8n evento=%s resultado=rechazado status=%s", event_type, error.code)
                    raise AutomationDeliveryError("n8n rechazó el evento") from None
            except (urllib.error.URLError, TimeoutError, OSError):
                retryable = True

            if not retryable:
                break
            if attempt < attempts:
                self._sleep(0.5 * (2 ** (attempt - 1)))

        logger.warning("n8n evento=%s resultado=fallido intentos=%d", event_type, attempts)
        raise AutomationDeliveryError("no se pudo entregar el evento a n8n")


class NullAutomationClient(AutomationClient):
    """Con las automatizaciones apagadas o sin configurar: no envía nada y no falla."""

    name = "null"

    def send(self, event_type, payload, idempotency_key):
        logger.info("automatizaciones apagadas: evento %s no enviado", event_type)
        return False
