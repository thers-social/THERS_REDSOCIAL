# Transportes de eventos hacia n8n (ADR-044 §2.8). El HTTP real solo existe si se configuran la URL y
# el secreto; no hay ninguna URL, clave ni cuenta de n8n inventada en el código ni en las pruebas.

from urllib.parse import urlparse

from app.application.automation.dispatch import EventTransport, TransportError


class HttpWebhookTransport(EventTransport):
    """POST firmado a un webhook de n8n. Solo HTTPS (HTTP únicamente hacia localhost, para
    desarrollo). Sin seguir redirecciones: una redirección podría llevar el mensaje a otro host."""

    def __init__(self, url, timeout_seconds=5.0):
        parsed = urlparse(url or "")
        local = parsed.hostname in ("localhost", "127.0.0.1", "::1")
        if parsed.scheme != "https" and not (parsed.scheme == "http" and local):
            raise ValueError("N8N_WEBHOOK_URL debe ser https (o http hacia localhost)")
        self._url = url
        self._timeout = timeout_seconds

    def send(self, body, headers):
        import requests

        try:
            response = requests.post(
                self._url, data=body, headers=headers, timeout=self._timeout, allow_redirects=False
            )
        except requests.RequestException as error:
            raise TransportError(type(error).__name__) from None
        if not 200 <= response.status_code < 300:
            raise TransportError(f"http_{response.status_code}")


class RecordingTransport(EventTransport):
    """Para pruebas y desarrollo: guarda lo que se habría enviado, sin red."""

    def __init__(self, fail_with=None):
        self.sent = []
        self.fail_with = fail_with

    def send(self, body, headers):
        if self.fail_with is not None:
            raise self.fail_with
        self.sent.append((body, headers))


def build_transport(config):
    """`None` si n8n está apagado o falta la URL o el secreto: nada se envía."""
    if not config.get("N8N_ENABLED"):
        return None
    if not config.get("N8N_WEBHOOK_URL") or not config.get("N8N_OUTBOUND_SECRET"):
        return None
    return HttpWebhookTransport(config["N8N_WEBHOOK_URL"], config.get("N8N_TIMEOUT_SECONDS", 5.0))
