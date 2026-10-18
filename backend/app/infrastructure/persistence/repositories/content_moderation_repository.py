# Adaptador SQLAlchemy de la moderación de contenido (ADR-044): trabajos, resultados, estado de las
# imágenes y auditoría. Único punto que traduce entre estas tablas y el resto de las capas.
#
# Dos reglas que viven AQUÍ, en SQL, y no solo en el código que llama:
#   * Reclamar un trabajo usa FOR UPDATE SKIP LOCKED: dos workers nunca toman el mismo.
#   * Una decisión AUTOMÁTICA solo cambia una fila que siga `pending` (compare-and-set): nunca
#     pisa lo que una persona ya decidió, ni reabre algo ya resuelto.

from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.domain.content_moderation import jobs, status, subjects
from app.domain.content_moderation.policy import POLICY_VERSION
from app.extensions import db
from app.infrastructure.persistence.models import (
    AdminAuditLog,
    ModerationJob,
    ModerationResult,
)


#: Tabla y columna del dueño de cada tipo de contenido. Cerrado: el nombre de tabla que entra en
#: el SQL sale de aquí, nunca de una entrada externa.
_TABLES = {
    subjects.MEDIA_ATTACHMENT: ("media_attachments", "owner_id"),
    subjects.STORY: ("stories", "author_id"),
}


def _table(subject_type):
    try:
        return _TABLES[subject_type]
    except KeyError:
        raise ValueError("unknown_subject_type") from None


class SQLAlchemyContentModerationRepository(jobs.ModerationJobRepository):
    # --- Trabajos -----------------------------------------------------------------------------

    def enqueue(self, kind, subject_type, subject_id):
        """Encola SIN confirmar: va en la misma transacción que el contenido (ADR-044 §2.2).
        Idempotente por `idempotency_key`."""
        key = jobs.idempotency_key(kind, subject_type, subject_id)
        db.session.execute(
            pg_insert(ModerationJob)
            .values(kind=kind, subject_type=subject_type, subject_id=subject_id,
                    idempotency_key=key)
            .on_conflict_do_nothing(index_elements=["idempotency_key"])
        )

    def claim_next(self, worker_id, now, lease_seconds):
        row = db.session.execute(
            text(
                """
                SELECT id FROM moderation_jobs
                WHERE (status IN ('queued', 'failed') AND next_attempt_at <= :now)
                   OR (status = 'running'
                       AND locked_at <= :now - make_interval(secs => :lease))
                ORDER BY next_attempt_at, created_at
                LIMIT 1
                FOR UPDATE SKIP LOCKED
                """
            ),
            {"now": now, "lease": lease_seconds},
        ).first()
        if row is None:
            db.session.rollback()
            return None
        job = db.session.execute(
            text(
                """
                UPDATE moderation_jobs
                SET status = 'running', locked_by = :worker, locked_at = :now,
                    attempts = attempts + 1
                WHERE id = :id
                RETURNING id, kind, subject_type, subject_id, attempts
                """
            ),
            {"id": row[0], "worker": worker_id, "now": now},
        ).mappings().one()
        db.session.commit()
        return dict(job)

    def mark_succeeded(self, job_id, now):
        db.session.execute(
            text(
                "UPDATE moderation_jobs SET status = 'succeeded', finished_at = :now, "
                "locked_by = NULL, locked_at = NULL, last_error = NULL WHERE id = :id"
            ),
            {"id": job_id, "now": now},
        )
        db.session.commit()

    def mark_failed(self, job_id, now, error_class, max_attempts, backoff_base):
        db.session.rollback()
        attempts = db.session.execute(
            text("SELECT attempts FROM moderation_jobs WHERE id = :id"), {"id": job_id}
        ).scalar_one()
        dead = attempts >= max_attempts
        delay = jobs.backoff_seconds(attempts, backoff_base)
        db.session.execute(
            text(
                """
                UPDATE moderation_jobs
                SET status = :status, last_error = :err, locked_by = NULL, locked_at = NULL,
                    next_attempt_at = :now + make_interval(secs => :delay),
                    finished_at = CASE WHEN :dead THEN CAST(:now AS timestamptz) ELSE NULL END
                WHERE id = :id
                """
            ),
            {"id": job_id, "now": now, "delay": delay, "dead": dead,
             "status": jobs.DEAD if dead else jobs.FAILED, "err": str(error_class)[:200]},
        )
        db.session.commit()
        return jobs.DEAD if dead else jobs.FAILED

    def save_result(self, job_id, signal, decision):
        """Un resultado por trabajo; reentregar un trabajo terminado no escribe un segundo.
        Guarda puntajes y categorías, NUNCA el contenido evaluado."""
        usable = signal is not None and signal.usable
        db.session.execute(
            pg_insert(ModerationResult)
            .values(
                job_id=job_id,
                provider=signal.provider if signal else "none",
                model_version=signal.model_version if signal else "none",
                categories=signal.categories_over(0.0) if usable else [],
                scores=signal.scores if usable else {},
                decision=decision.status, priority=decision.priority,
                policy_version=POLICY_VERSION,
            )
            .on_conflict_do_nothing(index_elements=["job_id"])
        )

    # --- Imágenes -----------------------------------------------------------------------------

    def subject_context(self, subject_type, subject_id):
        """Lo que el motor necesita saber de una imagen y de quien la subió. Nada del contenido."""
        table, owner = _table(subject_type)
        row = db.session.execute(
            text(
                f"""
                SELECT m.id, m.storage_key, m.{owner} AS owner_id, m.moderation_status,
                       EXTRACT(EPOCH FROM (now() - u.created_at)) / 86400.0 AS account_age_days,
                       (SELECT count(*) FROM reports r
                         WHERE r.status = 'open' AND r.reported_user_id = m.{owner}) AS open_reports
                FROM {table} m JOIN users u ON u.id = m.{owner}
                WHERE m.id = :id
                """
            ),
            {"id": str(subject_id)},
        ).mappings().first()
        return dict(row) if row else None

    def attachment_context(self, attachment_id):
        return self.subject_context(subjects.MEDIA_ATTACHMENT, attachment_id)

    def set_status_automatic(self, subject_id, new_status, now, subject_type=subjects.MEDIA_ATTACHMENT):
        """Compare-and-set: solo si sigue `pending`. Devuelve si cambió algo."""
        table, _ = _table(subject_type)
        result = db.session.execute(
            text(
                f"""
                UPDATE {table}
                SET moderation_status = :new, moderation_decided_by = :by,
                    moderation_decided_at = :now
                WHERE id = :id AND moderation_status = 'pending'
                """
            ),
            {"id": str(subject_id), "new": new_status, "by": status.ACTOR_AUTO, "now": now},
        )
        return result.rowcount == 1

    def set_status_human(self, subject_id, new_status, actor_id, now,
                         subject_type=subjects.MEDIA_ATTACHMENT):
        """Una persona puede decidir desde cualquier estado. Devuelve el estado anterior o None
        si el contenido no existe."""
        table, _ = _table(subject_type)
        row = db.session.execute(
            text(f"SELECT moderation_status FROM {table} WHERE id = :id FOR UPDATE"),
            {"id": str(subject_id)},
        ).first()
        if row is None:
            return None
        db.session.execute(
            text(
                f"UPDATE {table} SET moderation_status = :new, "
                "moderation_decided_by = :by, moderation_decided_at = :now WHERE id = :id"
            ),
            {"id": str(subject_id), "new": new_status, "by": str(actor_id), "now": now},
        )
        return row[0]

    # --- Auditoría ----------------------------------------------------------------------------

    def audit(self, actor_id, actor_kind, action, resource_type, resource_id, changes):
        """Sin confirmar: se confirma junto con el cambio que describe. `changes` nunca lleva
        el contenido evaluado."""
        db.session.add(
            AdminAuditLog(
                actor_id=actor_id, actor_kind=actor_kind, action=action,
                resource_type=resource_type, resource_id=resource_id, changes=changes,
            )
        )

    def commit(self):
        db.session.commit()

    def rollback(self):
        db.session.rollback()

    def is_withheld(self, storage_key):
        """¿El archivo es de una imagen adjunta que NO está aprobada? Los archivos que no son
        imágenes adjuntas (fotos de perfil, etc.) no se retienen."""
        return db.session.execute(
            text(
                "SELECT EXISTS (SELECT 1 FROM media_attachments "
                "WHERE storage_key = :key AND moderation_status <> 'approved') "
                "OR EXISTS (SELECT 1 FROM stories "
                "WHERE storage_key = :key AND moderation_status <> 'approved')"
            ),
            {"key": storage_key},
        ).scalar()
