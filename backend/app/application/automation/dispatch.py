# Despacho de eventos hacia n8n (ADR-044 §2.8). Sin Flask ni red: el transporte se inyecta.
#
# Garantías (cada una tiene su prueba):
#   * El cuerpo es el canónico del payload ya validado (identificadores, categorías y conteos).
#   * Va firmado con HMAC-SHA256 y marca de tiempo; el secreto no sale en ningún registro.
#   * Un fallo de n8n NO afecta a la moderación: el evento reintenta con espera creciente y, al
#     agotar los intentos, queda `dead`. Nada de esto toca el estado del contenido.
#   * Sin transporte configurado no se envía nada y los eventos esperan en la base.

import logging
import time

from app.domain.automation import events

_logger = logging.getLogger(__name__)


class TransportError(Exception):
    """Falla de entrega (red, tiempo, HTTP no 2xx). Sin cuerpo ni URL: solo la clase."""


class EventTransport:
    def send(self, body, headers):
        """Entrega `body` (bytes) con `headers`; lanza `TransportError` si no se pudo."""
        raise NotImplementedError


def dispatch_batch(repository, transport, secret, now, backoff_base=30, batch_size=20):
    """Envía los eventos listos. Devuelve `{"sent": n, "failed": n, "dead": n}`."""
    counts = {"sent": 0, "failed": 0, "dead": 0}
    if transport is None or not secret:
        return counts  # sin n8n configurado los eventos esperan; no se pierde ninguno
    batch = repository.claim_batch(now, batch_size)
    timestamp = int(now.timestamp()) if hasattr(now, "timestamp") else int(time.time())
    for event in batch:
        body = events.body_bytes({
            "id": str(event["id"]), "type": event["event_type"], "data": event["payload"],
        })
        headers = {
            "Content-Type": "application/json",
            events.SIGNATURE_HEADER: events.sign(secret, timestamp, body),
        }
        try:
            transport.send(body, headers)
        except Exception as error:  # noqa: BLE001 -- cualquier fallo reintenta
            _logger.warning("Evento %s no entregado: %s", event["event_type"], type(error).__name__)
            outcome = repository.mark_failed(event["id"], now, type(error).__name__, backoff_base)
            counts[outcome] += 1
        else:
            repository.mark_sent(event["id"], now)
            counts["sent"] += 1
    repository.commit()
    return counts
