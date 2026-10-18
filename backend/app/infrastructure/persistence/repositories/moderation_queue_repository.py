# Consultas del panel de moderación de contenido (ADR-044 §2.6) y apelaciones (§2.7). Solo lectura
# y operaciones de cola; las decisiones pasan por `SQLAlchemyContentModerationRepository`.
#
# Sirve a los dos tipos de contenido moderado (`subjects.py`): imágenes adjuntas e historias. El
# nombre de tabla sale de un diccionario CERRADO, nunca de una entrada externa.
#
# "Restringido": contenido con señal de seguridad infantil o ilegal por encima del piso crítico.
# Un `reviewer` no lo ve NI en la cola, NI en el detalle, NI en las apelaciones: el filtro vive en
# SQL, no en la interfaz.

from sqlalchemy import text

from app.domain.content_moderation import subjects
from app.domain.content_moderation.policy import Thresholds
from app.extensions import db

_FLOOR = Thresholds().critical_floor

_RESTRICTED_SQL = """
EXISTS (
  SELECT 1 FROM moderation_results r JOIN moderation_jobs j ON j.id = r.job_id
  WHERE j.subject_id = m.id AND (
    COALESCE((r.scores ->> 'child_safety')::float, 0) >= :floor OR
    COALESCE((r.scores ->> 'illegal')::float, 0) >= :floor)
)"""

_PRIORITY_ORDER = "CASE lr.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END"

#: tipo -> (tabla, columna del dueño, expresión del "padre" que se muestra al moderar)
_SPEC = {
    subjects.MEDIA_ATTACHMENT: (
        "media_attachments", "owner_id",
        "CASE WHEN m.post_id IS NOT NULL THEN 'post' WHEN m.message_id IS NOT NULL THEN 'message' "
        "ELSE 'review' END",
    ),
    subjects.STORY: ("stories", "author_id", "'story'"),
}


def _spec(subject_type):
    try:
        return _SPEC[subject_type]
    except KeyError:
        raise ValueError("unknown_subject_type") from None


def _item_select(subject_type):
    table, owner, parent = _spec(subject_type)
    return f"""
SELECT m.id, m.moderation_status AS status, {parent} AS parent_type,
       m.created_at, m.moderation_decided_by, m.moderation_decided_at,
       u.id AS owner_id, u.username AS owner_username,
       lr.priority, lr.scores, lr.decision, lr.created_at AS classified_at,
       (SELECT a.changes ->> 'reason' FROM admin_audit_log a
         WHERE a.resource_id = m.id AND a.action = 'moderation_auto_decision'
         ORDER BY a.created_at DESC LIMIT 1) AS reason,
       {_RESTRICTED_SQL} AS restricted
FROM {table} m
JOIN users u ON u.id = m.{owner}
LEFT JOIN LATERAL (
  SELECT r.priority, r.scores, r.decision, r.created_at
  FROM moderation_results r JOIN moderation_jobs j ON j.id = r.job_id
  WHERE j.subject_id = m.id ORDER BY r.created_at DESC LIMIT 1
) lr ON TRUE
"""


def _hide_restricted(can_see_restricted):
    return "" if can_see_restricted else f" AND NOT {_RESTRICTED_SQL}"


class SQLAlchemyModerationQueueRepository:
    # --- Cola y detalle -----------------------------------------------------------------------

    def list_items(self, statuses, limit, offset, can_see_restricted,
                   subject_type=subjects.MEDIA_ATTACHMENT):
        rows = db.session.execute(
            text(
                _item_select(subject_type)
                + " WHERE m.moderation_status = ANY(:statuses)"
                + _hide_restricted(can_see_restricted)
                + f" ORDER BY COALESCE({_PRIORITY_ORDER}, 2), m.created_at ASC"
                + " LIMIT :limit OFFSET :offset"
            ),
            {"statuses": list(statuses), "limit": limit + 1, "offset": offset, "floor": _FLOOR},
        ).mappings().all()
        return [dict(r) for r in rows[:limit]], len(rows) > limit

    def get_item(self, attachment_id, subject_type=subjects.MEDIA_ATTACHMENT):
        row = db.session.execute(
            text(_item_select(subject_type) + " WHERE m.id = :id"),
            {"id": str(attachment_id), "floor": _FLOOR},
        ).mappings().first()
        return dict(row) if row else None

    def results_for(self, attachment_id):
        rows = db.session.execute(
            text(
                "SELECT r.provider, r.model_version, r.categories, r.scores, r.decision, "
                "r.priority, r.policy_version, r.created_at "
                "FROM moderation_results r JOIN moderation_jobs j ON j.id = r.job_id "
                "WHERE j.subject_id = :id ORDER BY r.created_at"
            ),
            {"id": str(attachment_id)},
        ).mappings().all()
        return [dict(r) for r in rows]

    def trail_for(self, attachment_id, subject_type=subjects.MEDIA_ATTACHMENT):
        _spec(subject_type)
        rows = db.session.execute(
            text(
                "SELECT a.action, a.actor_kind, a.actor_id, u.username AS actor_username, "
                "a.changes, a.created_at FROM admin_audit_log a "
                "LEFT JOIN users u ON u.id = a.actor_id "
                "WHERE a.resource_id = :id AND a.resource_type = :rt "
                "ORDER BY a.created_at"
            ),
            {"id": str(attachment_id), "rt": subject_type},
        ).mappings().all()
        return [dict(r) for r in rows]

    def storage_ref(self, attachment_id, subject_type=subjects.MEDIA_ATTACHMENT):
        """`(clave, es_privado)` del archivo, o `None`. Solo las historias pueden ser privadas."""
        table, _, _ = _spec(subject_type)
        private = "file_private" if subject_type == subjects.STORY else "FALSE"
        row = db.session.execute(
            text(f"SELECT storage_key, {private} AS private FROM {table} WHERE id = :id"),
            {"id": str(attachment_id)},
        ).first()
        return (row[0], bool(row[1])) if row else None

    def storage_key(self, attachment_id):
        ref = self.storage_ref(attachment_id)
        return ref[0] if ref else None

    # --- Auditoría (solo admin) ---------------------------------------------------------------

    def audit_page(self, limit, offset):
        rows = db.session.execute(
            text(
                "SELECT a.id, a.action, a.actor_kind, a.actor_id, u.username AS actor_username, "
                "a.resource_type, a.resource_id, a.changes, a.created_at "
                "FROM admin_audit_log a LEFT JOIN users u ON u.id = a.actor_id "
                "WHERE a.action LIKE 'moderation\\_%' ORDER BY a.created_at DESC "
                "LIMIT :limit OFFSET :offset"
            ),
            {"limit": limit + 1, "offset": offset},
        ).mappings().all()
        return [dict(r) for r in rows[:limit]], len(rows) > limit

    # --- Trabajos fallidos --------------------------------------------------------------------

    def list_jobs(self, statuses, limit, offset):
        rows = db.session.execute(
            text(
                "SELECT id, kind, subject_type, subject_id, status, attempts, next_attempt_at, "
                "last_error, created_at, finished_at FROM moderation_jobs "
                "WHERE status = ANY(:statuses) ORDER BY created_at DESC LIMIT :limit OFFSET :offset"
            ),
            {"statuses": list(statuses), "limit": limit + 1, "offset": offset},
        ).mappings().all()
        return [dict(r) for r in rows[:limit]], len(rows) > limit

    def retry_job(self, job_id, now):
        """Devuelve el trabajo muerto o fallido a la cola. `None` si no existe o no estaba así."""
        row = db.session.execute(
            text(
                "UPDATE moderation_jobs SET status = 'queued', attempts = 0, next_attempt_at = :now, "
                "locked_by = NULL, locked_at = NULL, finished_at = NULL, last_error = NULL "
                "WHERE id = :id AND status IN ('dead', 'failed') RETURNING id, status"
            ),
            {"id": str(job_id), "now": now},
        ).mappings().first()
        return dict(row) if row else None

    # --- Estadísticas -------------------------------------------------------------------------

    def stats(self, can_see_restricted):
        """Suma los dos tipos de contenido moderado."""
        hide = _hide_restricted(can_see_restricted)
        params = {"floor": _FLOOR}
        by_status, held_by_priority = {}, {}
        week = {"auto_approved": 0, "auto_held": 0, "human_decisions": 0}
        human_hours, human_n = 0.0, 0
        for subject_type in subjects.ALL:
            table, _, _ = _spec(subject_type)
            for state, count in db.session.execute(
                text(f"SELECT m.moderation_status, count(*) FROM {table} m WHERE TRUE{hide} GROUP BY 1"),
                params,
            ).all():
                by_status[state] = by_status.get(state, 0) + count
            for priority, count in db.session.execute(
                text(
                    f"SELECT COALESCE(lr.priority, 'normal'), count(*) FROM {table} m "
                    "LEFT JOIN LATERAL (SELECT r.priority FROM moderation_results r "
                    "  JOIN moderation_jobs j ON j.id = r.job_id WHERE j.subject_id = m.id "
                    "  ORDER BY r.created_at DESC LIMIT 1) lr ON TRUE "
                    f"WHERE m.moderation_status = 'held'{hide} GROUP BY 1"
                ),
                params,
            ).all():
                held_by_priority[priority] = held_by_priority.get(priority, 0) + count
            row = db.session.execute(
                text(
                    "SELECT "
                    " count(*) FILTER (WHERE moderation_decided_by = 'auto' "
                    "                  AND moderation_status = 'approved') AS auto_approved, "
                    " count(*) FILTER (WHERE moderation_decided_by = 'auto' "
                    "                  AND moderation_status = 'held') AS auto_held, "
                    " count(*) FILTER (WHERE moderation_decided_by <> 'auto') AS human_decisions, "
                    " COALESCE(sum(EXTRACT(EPOCH FROM (moderation_decided_at - created_at)) / 3600.0) "
                    "   FILTER (WHERE moderation_decided_by <> 'auto'), 0) AS human_hours "
                    f"FROM {table} m "
                    f"WHERE moderation_decided_at >= now() - interval '7 days'{hide}"
                ),
                params,
            ).mappings().one()
            for key in week:
                week[key] += row[key]
            human_hours += float(row["human_hours"])
            human_n += row["human_decisions"]
        jobs_by_status = dict(
            db.session.execute(text("SELECT status, count(*) FROM moderation_jobs GROUP BY 1")).all()
        )
        appeals = db.session.execute(
            text(
                "SELECT count(*) FILTER (WHERE status = 'open') AS open, "
                "count(*) FILTER (WHERE status = 'open' "
                "                 AND created_at < now() - interval '72 hours') AS overdue "
                "FROM moderation_appeals"
            )
        ).mappings().one()
        return {
            "by_status": by_status,
            "held_by_priority": held_by_priority,
            "jobs_by_status": jobs_by_status,
            "last_7_days": {
                **week,
                "avg_hours_to_human_decision": (
                    None if human_n == 0 else round(human_hours / human_n, 2)
                ),
            },
            "appeals": {"open": appeals["open"], "overdue": appeals["overdue"]},
        }

    # --- Apelaciones --------------------------------------------------------------------------

    def attachment_for_appeal(self, attachment_id, subject_type=subjects.MEDIA_ATTACHMENT):
        table, owner, _ = _spec(subject_type)
        row = db.session.execute(
            text(
                f"SELECT id, {owner} AS owner_id, moderation_status, moderation_decided_by "
                f"FROM {table} WHERE id = :id"
            ),
            {"id": str(attachment_id)},
        ).mappings().first()
        return dict(row) if row else None

    def count_open_appeals(self, user_id):
        return db.session.execute(
            text("SELECT count(*) FROM moderation_appeals WHERE user_id = :u AND status = 'open'"),
            {"u": str(user_id)},
        ).scalar()

    def create_appeal(self, user_id, attachment_id, reason, original_decided_by,
                      subject_type=subjects.MEDIA_ATTACHMENT):
        """`None` si ya había una abierta para ese contenido (índice único parcial)."""
        _spec(subject_type)
        row = db.session.execute(
            text(
                "INSERT INTO moderation_appeals (user_id, subject_type, subject_id, reason, "
                "original_decided_by) VALUES (:u, :t, :s, :r, :d) "
                "ON CONFLICT DO NOTHING RETURNING id, created_at"
            ),
            {"u": str(user_id), "t": subject_type, "s": str(attachment_id), "r": reason,
             "d": original_decided_by},
        ).mappings().first()
        return dict(row) if row else None

    def my_appeals(self, user_id):
        rows = db.session.execute(
            text(
                "SELECT id, subject_id AS attachment_id, subject_type, status, reason, "
                "resolution_note, created_at, resolved_at FROM moderation_appeals "
                "WHERE user_id = :u ORDER BY created_at DESC LIMIT 50"
            ),
            {"u": str(user_id)},
        ).mappings().all()
        return [dict(r) for r in rows]

    def list_appeals(self, status, limit, offset, can_see_restricted):
        hide = (
            "" if can_see_restricted
            else " AND NOT EXISTS (SELECT 1 FROM moderation_results r JOIN moderation_jobs j "
                 "ON j.id = r.job_id WHERE j.subject_id = a.subject_id AND ("
                 "COALESCE((r.scores ->> 'child_safety')::float, 0) >= :floor OR "
                 "COALESCE((r.scores ->> 'illegal')::float, 0) >= :floor))"
        )
        rows = db.session.execute(
            text(
                "SELECT a.id, a.subject_id AS attachment_id, a.subject_type, a.status, a.reason, "
                "a.created_at, a.resolved_at, a.resolution_note, u.username AS appellant, "
                "(a.status = 'open' AND a.created_at < now() - interval '72 hours') AS overdue, "
                "a.created_at + interval '72 hours' AS due_at "
                "FROM moderation_appeals a JOIN users u ON u.id = a.user_id "
                "WHERE a.status = :status" + hide
                + " ORDER BY a.created_at ASC LIMIT :limit OFFSET :offset"
            ),
            {"status": status, "limit": limit + 1, "offset": offset, "floor": _FLOOR},
        ).mappings().all()
        return [dict(r) for r in rows[:limit]], len(rows) > limit

    def lock_appeal(self, appeal_id):
        row = db.session.execute(
            text(
                "SELECT id, user_id, subject_type, subject_id, status, original_decided_by "
                "FROM moderation_appeals WHERE id = :id FOR UPDATE"
            ),
            {"id": str(appeal_id)},
        ).mappings().first()
        return dict(row) if row else None

    def resolve_appeal(self, appeal_id, outcome, reviewer_id, note, now):
        db.session.execute(
            text(
                "UPDATE moderation_appeals SET status = :s, reviewer_id = :r, "
                "resolution_note = :n, resolved_at = :now WHERE id = :id"
            ),
            {"id": str(appeal_id), "s": outcome, "r": str(reviewer_id), "n": note, "now": now},
        )
