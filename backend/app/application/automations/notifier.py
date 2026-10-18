# Avisos que el backend le entrega a n8n (ADR-041 §7). Flask decide SI se avisa y QUÉ datos viajan;
# n8n solo entrega el correo. Nada de esto retrasa ni rompe la acción que lo origina.

import logging

from app.domain.automations import events
from app.domain.automations.client import AutomationDeliveryError

logger = logging.getLogger(__name__)


class AutomationNotifier:
    def __init__(self, client, runner, repository):
        self._client = client
        self._runner = runner
        self._repository = repository

    @property
    def enabled(self):
        return self._client.name != "null"

    def _dispatch(self, event_type, payload, key):
        def task():
            try:
                self._client.send(event_type, payload, key)
            except AutomationDeliveryError:
                # Ya quedó registrado por el cliente (sin datos). n8n no es fuente de verdad: perder
                # un aviso de cortesía no deja nada inconsistente en THERS.
                logger.warning("aviso %s no entregado", event_type)

        self._runner(task)

    def report_resolved(self, report_id, status):
        """Avisa a quien reportó que su reporte se cerró. Devuelve `True` si se encargó el envío.

        Solo se avisa si: las automatizaciones están encendidas, el estado es uno de los que se
        comunican, el reporte aún tiene reportante (su cuenta no se borró), su correo está
        verificado y la cuenta no está suspendida. El mensaje es genérico: no dice qué se hizo, ni a
        quién, ni lo que escribió quien moderó."""
        if not self.enabled:
            return False
        outcome = events.outcome_for_status(status)
        if outcome is None:
            return False
        reporter = self._repository.reporter_for_report(report_id)
        if not reporter or not reporter["email_verified"] or reporter["suspended"]:
            return False
        self._dispatch(
            events.EVENT_REPORT_RESOLVED,
            events.report_resolved_payload(report_id, outcome, reporter["email"]),
            events.idempotency_key(events.EVENT_REPORT_RESOLVED, report_id),
        )
        return True
