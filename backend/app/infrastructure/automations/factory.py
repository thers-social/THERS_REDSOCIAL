# Fábrica del cliente de automatizaciones y de su ejecutor (ADR-041 §7). Un solo punto decide qué se
# usa, igual que `infrastructure/ai/factory.py`. El estado vive en `app.extensions`: cada aplicación
# (y cada prueba) tiene el suyo, y las pruebas inyectan un cliente simulado y un ejecutor inmediato.

import logging
import threading

from app.infrastructure.automations.n8n_client import N8nClient, NullAutomationClient

logger = logging.getLogger(__name__)

_KEY = "thers_automations"


def run_in_background(task):
    """Ejecuta `task` en un hilo aparte: avisar a n8n NUNCA debe retrasar ni romper la acción que
    lo origina (p. ej. resolver un reporte). Es de mejor esfuerzo: si el proceso se cae a mitad,
    el aviso se pierde, y es aceptable porque n8n no es fuente de verdad (ADR-041 §7)."""

    def guarded():
        try:
            task()
        except Exception as error:  # noqa: BLE001 -- un fallo del aviso no puede escapar
            logger.warning("aviso a n8n falló (%s)", type(error).__name__)

    threading.Thread(target=guarded, daemon=True).start()


def create_client(config):
    """`NullAutomationClient` si están apagadas o falta la URL o el secreto."""
    if not config.get("TERO_AUTOMATIONS_ENABLED"):
        return NullAutomationClient()
    base_url, secret = config.get("N8N_BASE_URL"), config.get("N8N_WEBHOOK_SECRET")
    if not base_url or not secret:
        return NullAutomationClient()
    return N8nClient(
        base_url, secret,
        timeout_seconds=config.get("N8N_TIMEOUT_SECONDS"),
        max_retries=config.get("N8N_MAX_RETRIES"),
    )


def automation_state(app):
    """`{"client": ..., "runner": ...}` de la aplicación; se crea la primera vez."""
    state = app.extensions.get(_KEY)
    if state is None:
        state = {"client": create_client(app.config), "runner": run_in_background}
        app.extensions[_KEY] = state
    return state
