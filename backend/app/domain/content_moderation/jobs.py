# Trabajos de moderación (ADR-044 §2.2): estados, espera entre reintentos y puerto.

QUEUED = "queued"
RUNNING = "running"
SUCCEEDED = "succeeded"
FAILED = "failed"
DEAD = "dead"

KIND_IMAGE = "classify_image"
SUBJECT_MEDIA_ATTACHMENT = "media_attachment"


def idempotency_key(kind, subject_type, subject_id):
    """El mismo hecho produce siempre la misma clave: encolarlo dos veces no duplica el trabajo."""
    return f"{kind}:{subject_type}:{subject_id}"


def backoff_seconds(attempts, base):
    """Espera antes del siguiente intento: base, 2×base, 4×base… con tope de una hora."""
    return min(base * (2 ** max(attempts - 1, 0)), 3600)


class ModerationJobRepository:
    """Puerto de persistencia de `moderation_jobs`/`moderation_results`."""

    def claim_next(self, worker_id, now, lease_seconds):
        """Reserva UN trabajo listo (`queued`/`failed` con `next_attempt_at <= now`, o `running`
        con la reserva vencida) sin que otro worker pueda tomarlo. `None` si no hay."""
        raise NotImplementedError

    def mark_succeeded(self, job_id, now):
        raise NotImplementedError

    def mark_failed(self, job_id, now, error_class, max_attempts, backoff_base):
        """Registra el fallo. Con `attempts >= max_attempts` el trabajo pasa a `dead`."""
        raise NotImplementedError
