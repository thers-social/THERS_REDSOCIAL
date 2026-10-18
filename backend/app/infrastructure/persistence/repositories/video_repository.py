# Persistencia de Reels (ADR-043-A): videos, libro de webhooks de Mux y borrados externos. Único punto
# que traduce entre esas tablas y el resto de las capas.
#
# Regla que vive AQUÍ, en SQL: un tercero solo lee un video si está `ready` Y `approved`, el autor no
# está suspendido, no hay bloqueo en ningún sentido y (si la cuenta es privada) lo sigue con follow
# aceptado. El estado de moderación NO depende de `MODERATION_ENABLED`: un video nuevo nace
# `pending` y sin aprobación nadie lo ve (falla cerrado).

from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.domain.content_moderation import jobs as moderation_jobs
from app.domain.content_moderation import subjects
from app.domain.content_moderation.jobs import backoff_seconds
from app.domain.restrictions.kinds import BLOCK
from app.domain.videos import rules
from app.extensions import db
from app.infrastructure.persistence.models import MuxWebhookEvent

DELETION_MAX_ATTEMPTS = 8

_COLUMNS = (
    "v.id, v.owner_id, v.caption, v.status, v.mux_upload_id, v.mux_asset_id, v.mux_playback_id, "
    "v.duration_ms, v.width, v.height, v.failure_reason, v.moderation_status, v.created_at, "
    "v.ready_at, u.username AS owner_username, u.name AS owner_name, "
    "u.avatar_path AS owner_avatar_path"
)

# Visibilidad para un tercero (mismas reglas que el feed de publicaciones, ADR-022/ADR-029).
_VISIBLE_TO_VIEWER = """
    v.status = 'ready' AND v.moderation_status = 'approved' AND u.suspended_at IS NULL
    AND (
        u.is_private = FALSE
        OR EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = CAST(:viewer AS uuid)
                   AND f.followed_id = v.owner_id AND f.status = 'accepted')
    )
    AND NOT EXISTS (
        SELECT 1 FROM user_restrictions r WHERE r.kind = :block AND (
            (r.owner_id = CAST(:viewer AS uuid) AND r.target_id = v.owner_id)
            OR (r.owner_id = v.owner_id AND r.target_id = CAST(:viewer AS uuid)))
    )
"""


def _row(mapping):
    return dict(mapping) if mapping else None


class SQLAlchemyVideoRepository:
    # --- Reserva y ciclo de vida --------------------------------------------------------------

    def get_owner_username(self, user_id):
        return db.session.execute(
            text("SELECT username FROM users WHERE id = :id"), {"id": str(user_id)}
        ).scalar()

    def reserve(self, owner_id, caption, idempotency_key):
        """Crea la reserva. Con la misma clave devuelve la existente (`created=False`): reintentar
        no abre una segunda subida en Mux."""
        row = db.session.execute(
            text(
                "INSERT INTO videos (owner_id, caption, idempotency_key) "
                "VALUES (:o, :c, :k) ON CONFLICT (owner_id, idempotency_key) "
                "WHERE idempotency_key IS NOT NULL DO NOTHING RETURNING id"
            ),
            {"o": str(owner_id), "c": caption, "k": idempotency_key},
        ).first()
        if row is not None:
            return self.get(row[0]), True
        existing = db.session.execute(
            text("SELECT id FROM videos WHERE owner_id = :o AND idempotency_key = :k"),
            {"o": str(owner_id), "k": idempotency_key},
        ).first()
        return self.get(existing[0]), False

    def get(self, video_id):
        return _row(db.session.execute(
            text(f"SELECT {_COLUMNS} FROM videos v JOIN users u ON u.id = v.owner_id WHERE v.id = :id"),
            {"id": str(video_id)},
        ).mappings().first())

    def find_by_upload(self, upload_id):
        row = db.session.execute(
            text("SELECT id FROM videos WHERE mux_upload_id = :u"), {"u": upload_id}
        ).first()
        return self.get(row[0]) if row else None

    def find_by_asset(self, asset_id):
        row = db.session.execute(
            text("SELECT id FROM videos WHERE mux_asset_id = :a"), {"a": asset_id}
        ).first()
        return self.get(row[0]) if row else None

    def _transition(self, video_id, allowed_from, new_status, sets="", params=None):
        """UPDATE condicionado al estado actual: una transición ilegal no cambia nada."""
        result = db.session.execute(
            text(
                f"UPDATE videos SET status = :new, updated_at = now(){sets} "
                "WHERE id = :id AND status = ANY(:from_)"
            ),
            {"id": str(video_id), "new": new_status, "from_": list(allowed_from), **(params or {})},
        )
        return result.rowcount == 1

    def mark_uploading(self, video_id, upload_id):
        return self._transition(video_id, (rules.PENDING,), rules.UPLOADING,
                                ", mux_upload_id = :u", {"u": upload_id})

    def mark_failed(self, video_id, reason):
        return self._transition(video_id, (rules.PENDING, rules.UPLOADING, rules.PROCESSING),
                                rules.FAILED, ", failure_reason = :r", {"r": reason[:40]})

    def mark_processing(self, video_id, asset_id):
        return self._transition(video_id, (rules.UPLOADING,), rules.PROCESSING,
                                ", mux_asset_id = :a", {"a": asset_id})

    def mark_ready(self, video_id, playback_id, duration_ms, width, height):
        """`ready` y, en la MISMA transacción, el trabajo de moderación (el video sigue `pending`)."""
        changed = self._transition(
            video_id, (rules.PROCESSING,), rules.READY,
            ", mux_playback_id = :p, duration_ms = :d, width = :w, height = :h, ready_at = now()",
            {"p": playback_id, "d": duration_ms, "w": width, "h": height},
        )
        if changed:
            from app.infrastructure.persistence.repositories.content_moderation_repository import (
                SQLAlchemyContentModerationRepository,
            )

            SQLAlchemyContentModerationRepository().enqueue(
                moderation_jobs.KIND_IMAGE, subjects.VIDEO, video_id
            )
        return changed

    def mark_blocked(self, video_id, reason):
        return self._transition(video_id, (rules.PROCESSING, rules.READY), rules.BLOCKED,
                                ", failure_reason = :r", {"r": reason[:40]})

    # --- Lecturas -----------------------------------------------------------------------------

    def get_visible(self, video_id, viewer_id):
        """El video si `viewer_id` es su dueño (con cualquier estado) o puede verlo."""
        return _row(db.session.execute(
            text(
                f"SELECT {_COLUMNS} FROM videos v JOIN users u ON u.id = v.owner_id "
                "WHERE v.id = :id AND (v.owner_id = CAST(:viewer AS uuid) OR ("
                + _VISIBLE_TO_VIEWER + "))"
            ),
            {"id": str(video_id), "viewer": str(viewer_id), "block": BLOCK},
        ).mappings().first())

    def list_visible(self, viewer_id, author_id, limit, offset):
        rows = db.session.execute(
            text(
                f"SELECT {_COLUMNS} FROM videos v JOIN users u ON u.id = v.owner_id "
                "WHERE (" + _VISIBLE_TO_VIEWER + ") "
                "AND (CAST(:author AS uuid) IS NULL OR v.owner_id = CAST(:author AS uuid)) "
                "ORDER BY v.ready_at DESC, v.id LIMIT :limit OFFSET :offset"
            ),
            {"viewer": str(viewer_id), "author": str(author_id) if author_id else None,
             "block": BLOCK, "limit": limit + 1, "offset": offset},
        ).mappings().all()
        return [dict(r) for r in rows[:limit]], len(rows) > limit

    def list_mine(self, owner_id, limit):
        rows = db.session.execute(
            text(f"SELECT {_COLUMNS} FROM videos v JOIN users u ON u.id = v.owner_id "
                 "WHERE v.owner_id = :o ORDER BY v.created_at DESC LIMIT :limit"),
            {"o": str(owner_id), "limit": limit},
        ).mappings().all()
        return [dict(r) for r in rows]

    # --- Borrado ------------------------------------------------------------------------------

    def delete(self, video_id, owner_id):
        """Borra la fila y encola el borrado del asset de Mux EN LA MISMA transacción. Devuelve
        `True` si existía y era suya."""
        row = db.session.execute(
            text("DELETE FROM videos WHERE id = :id AND owner_id = :o RETURNING mux_asset_id"),
            {"id": str(video_id), "o": str(owner_id)},
        ).first()
        if row is None:
            return False
        if row[0]:
            self.enqueue_external_deletion("mux", row[0])
        return True

    def enqueue_external_deletion(self, provider, external_id):
        db.session.execute(
            text(
                "INSERT INTO pending_external_deletions (provider, external_id) VALUES (:p, :e) "
                "ON CONFLICT (provider, external_id) DO NOTHING"
            ),
            {"p": provider, "e": external_id},
        )

    # --- Libro de webhooks --------------------------------------------------------------------

    def record_event(self, event_id, event_type, object_id, status, data):
        """`True` si el evento es NUEVO; `False` si ya estaba (webhook repetido: no se reprocesa)."""
        inserted = db.session.execute(
            pg_insert(MuxWebhookEvent)
            .values(event_id=event_id, event_type=event_type, object_id=object_id,
                    status=status, data=data)
            .on_conflict_do_nothing(index_elements=["event_id"])
            .returning(MuxWebhookEvent.event_id)
        ).first()
        return inserted is not None

    def set_event_status(self, event_id, status):
        db.session.execute(
            text("UPDATE mux_webhook_events SET status = :s WHERE event_id = :id"),
            {"s": status, "id": event_id},
        )

    def deferred_events(self, limit):
        rows = db.session.execute(
            text("SELECT event_id, event_type, object_id, data FROM mux_webhook_events "
                 "WHERE status = 'deferred' ORDER BY received_at LIMIT :l FOR UPDATE SKIP LOCKED"),
            {"l": limit},
        ).mappings().all()
        return [dict(r) for r in rows]

    # --- Borrados externos pendientes ---------------------------------------------------------

    def claim_deletions(self, now, limit):
        rows = db.session.execute(
            text(
                "SELECT id, provider, external_id, attempts FROM pending_external_deletions "
                "WHERE status IN ('queued', 'failed') AND next_attempt_at <= :now "
                "ORDER BY next_attempt_at LIMIT :limit FOR UPDATE SKIP LOCKED"
            ),
            {"now": now, "limit": limit},
        ).mappings().all()
        return [dict(r) for r in rows]

    def mark_deletion_done(self, deletion_id, now):
        db.session.execute(
            text("UPDATE pending_external_deletions SET status = 'done', done_at = :now, "
                 "attempts = attempts + 1, last_error = NULL WHERE id = :id"),
            {"id": str(deletion_id), "now": now},
        )

    def mark_deletion_failed(self, deletion_id, now, error_class, backoff_base):
        attempts = db.session.execute(
            text("SELECT attempts FROM pending_external_deletions WHERE id = :id"),
            {"id": str(deletion_id)},
        ).scalar_one() + 1
        dead = attempts >= DELETION_MAX_ATTEMPTS
        db.session.execute(
            text(
                "UPDATE pending_external_deletions SET status = :s, attempts = :a, last_error = :e, "
                "next_attempt_at = :now + make_interval(secs => :delay) WHERE id = :id"
            ),
            {"id": str(deletion_id), "s": "dead" if dead else "failed", "a": attempts,
             "e": str(error_class)[:200], "now": now, "delay": backoff_seconds(attempts, backoff_base)},
        )
        return "dead" if dead else "failed"

    def commit(self):
        db.session.commit()

    def rollback(self):
        db.session.rollback()
