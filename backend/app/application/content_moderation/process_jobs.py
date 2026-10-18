# Worker de moderación (ADR-044 §2.2-§2.4). Un ciclo = reclamar un trabajo, clasificar, decidir con
# el motor de políticas, guardar resultado + estado + auditoría en UNA transacción.
#
# Garantías (cada una tiene su prueba):
#   * Falla cerrado: error del clasificador, señal inutilizable o trabajo `dead` NUNCA aprueban.
#   * Idempotente: reentregar un trabajo terminado no escribe un segundo resultado ni cambia nada.
#   * Una decisión automática nunca pisa la de una persona (compare-and-set en el repositorio).
#   * Nada de lo que se guarda lleva el contenido evaluado.

import logging

from app.domain.content_moderation import jobs, policy, status
from app.domain.content_moderation.signals import ClassifierError

_logger = logging.getLogger(__name__)

AUDIT_ACTION = "moderation_auto_decision"
AUDIT_RESOURCE = "media_attachment"


def process_next(repository, image_classifier, settings, worker_id, now):
    """Procesa UN trabajo. Devuelve `None` si no había ninguno, o `(job_id, resultado)` con
    resultado en {'succeeded', 'failed', 'dead'}."""
    job = repository.claim_next(worker_id, now, settings.lease_seconds)
    if job is None:
        return None
    try:
        _process(repository, image_classifier, settings, job, now)
    except Exception as error:  # noqa: BLE001 -- cualquier fallo reintenta; nunca aprueba
        # Solo la CLASE del error: ni mensaje del proveedor ni datos del contenido (ADR-045 §3).
        _logger.warning("Trabajo de moderación %s falló: %s", job["id"], type(error).__name__)
        outcome = repository.mark_failed(
            job["id"], now, type(error).__name__, settings.max_attempts, settings.backoff_base
        )
        return job["id"], outcome
    return job["id"], jobs.SUCCEEDED


def _process(repository, image_classifier, settings, job, now):
    if job["kind"] != jobs.KIND_IMAGE or job["subject_type"] != jobs.SUBJECT_MEDIA_ATTACHMENT:
        raise ValueError("unsupported_job")  # un tipo desconocido no se aprueba ni se descarta

    context = repository.attachment_context(job["subject_id"])
    if context is None:
        # El contenido ya no existe (se borró): no hay nada que moderar.
        repository.mark_succeeded(job["id"], now)
        return
    if context["moderation_status"] != status.PENDING:
        # Ya lo resolvió una persona o un ciclo anterior: no se reabre ni se pisa.
        repository.mark_succeeded(job["id"], now)
        return

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
    changed = repository.set_status_automatic(job["subject_id"], decision.status, now)
    if changed:
        repository.audit(
            None, status.ACTOR_KIND_SYSTEM, AUDIT_ACTION, AUDIT_RESOURCE, job["subject_id"],
            {"from": status.PENDING, "to": decision.status, "priority": decision.priority,
             "reason": decision.reason, "policy": policy.POLICY_VERSION},
        )
    repository.commit()
    repository.mark_succeeded(job["id"], now)
