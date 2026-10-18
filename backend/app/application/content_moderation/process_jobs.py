# Worker de moderación (ADR-044 §2.2-§2.4). Un ciclo = reclamar un trabajo, clasificar, decidir con
# el motor de políticas, guardar resultado + estado + auditoría en UNA transacción.
#
# Garantías (cada una tiene su prueba):
#   * Falla cerrado: error del clasificador, señal inutilizable o trabajo `dead` NUNCA aprueban.
#   * Idempotente: reentregar un trabajo terminado no escribe un segundo resultado ni cambia nada.
#   * Una decisión automática nunca pisa la de una persona (compare-and-set en el repositorio).
#   * Nada de lo que se guarda lleva el contenido evaluado.

import logging

from app.domain.automation import events as automation_events
from app.domain.content_moderation import jobs, policy, status, subjects
from app.domain.content_moderation.signals import ClassifierError

_logger = logging.getLogger(__name__)

AUDIT_ACTION = "moderation_auto_decision"


def process_next(repository, image_classifier, settings, worker_id, now, events=None, alerter=None):
    """Procesa UN trabajo. Devuelve `None` si no había ninguno, o `(job_id, resultado)` con
    resultado en {'succeeded', 'failed', 'dead'}."""
    job = repository.claim_next(worker_id, now, settings.lease_seconds)
    if job is None:
        return None
    try:
        critical = _process(repository, image_classifier, settings, job, now, events)
    except Exception as error:  # noqa: BLE001 -- cualquier fallo reintenta; nunca aprueba
        # Solo la CLASE del error: ni mensaje del proveedor ni datos del contenido (ADR-045 §3).
        _logger.warning("Trabajo de moderación %s falló: %s", job["id"], type(error).__name__)
        outcome = repository.mark_failed(
            job["id"], now, type(error).__name__, settings.max_attempts, settings.backoff_base
        )
        if outcome == jobs.DEAD and events is not None:
            _emit(events, automation_events.JOB_DEAD, {
                "job_id": str(job["id"]), "subject_type": job["subject_type"],
                "attempts": int(job["attempts"]),
            }, job["id"])
        return job["id"], outcome
    # Aviso DIRECTO por correo (decisión 6): sale de Flask, no depende de que n8n esté arriba.
    if critical and alerter is not None:
        alerter.alert("content_critical")
    return job["id"], jobs.SUCCEEDED


def _emit(events, event_type, fields, *key):
    """Encola un evento hacia n8n. Un evento mal formado o un fallo de la outbox NUNCA afecta a la
    moderación: se registra la clase del error y se sigue."""
    try:
        events.enqueue(event_type, fields, *key)
        events.commit()
    except Exception as error:  # noqa: BLE001
        events.rollback()
        _logger.warning("Evento %s no encolado: %s", event_type, type(error).__name__)


def _process(repository, image_classifier, settings, job, now, events=None):
    """Devuelve `True` si lo dejó retenido como crítico (para avisar al equipo)."""
    if job["kind"] != jobs.KIND_IMAGE or not subjects.is_known(job["subject_type"]):
        raise ValueError("unsupported_job")  # un tipo desconocido no se aprueba ni se descarta

    context = repository.subject_context(job["subject_type"], job["subject_id"])
    if context is None:
        # El contenido ya no existe (se borró): no hay nada que moderar.
        repository.mark_succeeded(job["id"], now)
        return False
    if context["moderation_status"] != status.PENDING:
        # Ya lo resolvió una persona o un ciclo anterior: no se reabre ni se pisa.
        repository.mark_succeeded(job["id"], now)
        return False

    signal = None
    if image_classifier is not None:
        try:
            signal = image_classifier.classify(context["storage_key"])
        except ClassifierError:
            raise  # se reintenta; el contenido sigue `pending`
    decision = policy.decide(
        signal, float(context["account_age_days"]), int(context["open_reports"]),
        settings.thresholds,
    )

    repository.save_result(job["id"], signal, decision)
    changed = repository.set_status_automatic(
        job["subject_id"], decision.status, now, subject_type=job["subject_type"]
    )
    if changed:
        repository.audit(
            None, status.ACTOR_KIND_SYSTEM, AUDIT_ACTION, job["subject_type"], job["subject_id"],
            {"from": status.PENDING, "to": decision.status, "priority": decision.priority,
             "reason": decision.reason, "policy": policy.POLICY_VERSION},
        )
    is_critical = changed and decision.status == status.HELD \
        and decision.priority == policy.PRIORITY_CRITICAL
    if is_critical and events is not None:
        # En la MISMA transacción que la decisión: o salen las dos cosas o ninguna.
        events.enqueue(automation_events.CRITICAL_HELD, {
            "subject_type": job["subject_type"], "subject_id": str(job["subject_id"]),
            "priority": decision.priority, "reason": decision.reason,
        }, job["subject_type"], job["subject_id"])
    repository.commit()
    repository.mark_succeeded(job["id"], now)
    return bool(is_critical)
