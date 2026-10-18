# Outbox de eventos hacia n8n (ADR-044 §2.8). El evento se guarda en la MISMA transacción que el
# hecho que lo origina; el envío es aparte, con reintentos. Si n8n está caído, el contenido sigue sin
# publicarse (la visibilidad vive en la base) y los eventos esperan.

from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.domain.automation import events
from app.domain.content_moderation import jobs as job_rules
from app.extensions import db
from app.infrastructure.persistence.models import DomainEvent

MAX_ATTEMPTS = 8


class SQLAlchemyDomainEventRepository:
    def enqueue(self, event_type, fields, *key_parts):
        """Valida contra el esquema cerrado y encola SIN confirmar. Idempotente por clave."""
        payload = events.build_event(event_type, fields)
        db.session.execute(
            pg_insert(DomainEvent)
            .values(
                event_type=event_type, payload=payload,
                idempotency_key=events.idempotency_key(event_type, *key_parts),
            )
            .on_conflict_do_nothing(index_elements=["idempotency_key"])
        )

    def claim_batch(self, now, limit):
        """Eventos listos, reservados con SKIP LOCKED (dos despachadores no toman el mismo)."""
        rows = db.session.execute(
            text(
                """
                SELECT id, event_type, payload, attempts FROM domain_events
                WHERE status IN ('queued', 'failed') AND next_attempt_at <= :now
                ORDER BY next_attempt_at, created_at
                LIMIT :limit
                FOR UPDATE SKIP LOCKED
                """
            ),
            {"now": now, "limit": limit},
        ).mappings().all()
        return [dict(r) for r in rows]

    def mark_sent(self, event_id, now):
        db.session.execute(
            text("UPDATE domain_events SET status = 'sent', sent_at = :now, last_error = NULL, "
                 "attempts = attempts + 1 WHERE id = :id"),
            {"id": str(event_id), "now": now},
        )

    def mark_failed(self, event_id, now, error_class, backoff_base):
        attempts = db.session.execute(
            text("SELECT attempts FROM domain_events WHERE id = :id"), {"id": str(event_id)}
        ).scalar_one() + 1
        dead = attempts >= MAX_ATTEMPTS
        db.session.execute(
            text(
                "UPDATE domain_events SET status = :s, attempts = :a, last_error = :e, "
                "next_attempt_at = :now + make_interval(secs => :delay) WHERE id = :id"
            ),
            {"id": str(event_id), "s": "dead" if dead else "failed", "a": attempts,
             "e": str(error_class)[:200], "now": now,
             "delay": job_rules.backoff_seconds(attempts, backoff_base)},
        )
        return "dead" if dead else "failed"

    def commit(self):
        db.session.commit()

    def rollback(self):
        db.session.rollback()
