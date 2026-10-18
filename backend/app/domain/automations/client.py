# Puerto del cliente de automatizaciones (ADR-041 §7). Cambiar n8n por otra herramienta es escribir
# otra clase que cumpla esto en infrastructure/automations/; nada más del backend conoce n8n.

from abc import ABC, abstractmethod


class AutomationDeliveryError(Exception):
    """No se pudo entregar el evento (red, tiempo, 5xx o rechazo). El mensaje nunca lleva el
    cuerpo enviado ni la respuesta del servicio: pueden contener datos de personas."""


class AutomationClient(ABC):
    name = "abstract"

    @abstractmethod
    def send(self, event_type, payload, idempotency_key):
        """Entrega un evento firmado. Devuelve `True` si el servicio lo aceptó; lanza
        `AutomationDeliveryError` si no pudo (tras los reintentos que le correspondan)."""
