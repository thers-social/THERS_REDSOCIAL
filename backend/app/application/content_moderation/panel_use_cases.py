# Casos de uso del panel de moderación de contenido y de las apelaciones (ADR-044 §2.6–§2.7).
# Sin Flask: la ruta pasa el rol ya resuelto y la hora.

from app.application.content_moderation import human_decision
from app.domain.content_moderation import roles, status, subjects

APPEAL_TARGET_HOURS = 72
MAX_OPEN_APPEALS = 5
MAX_REASON = 500
MAX_NOTE = 500
PAGE_MAX = 50

APPEALABLE = (status.HELD, status.REJECTED)
STATUS_TABS = {"held": (status.HELD,), "pending": (status.PENDING,), "rejected": (status.REJECTED,),
               "all": (status.HELD, status.PENDING, status.REJECTED)}
JOB_TABS = {"failed": ("failed",), "dead": ("dead",), "all": ("failed", "dead")}


class NotFoundError(Exception):
    pass


class InvalidRequestError(Exception):
    def __init__(self, message):
        super().__init__(message)
        self.message = message


class ConflictError(Exception):
    def __init__(self, message):
        super().__init__(message)
        self.message = message


class ForbiddenError(Exception):
    def __init__(self, message):
        super().__init__(message)
        self.message = message


class TooManyAppealsError(Exception):
    pass


def _page(limit_raw, offset_raw):
    try:
        limit = int(limit_raw) if limit_raw not in (None, "") else 20
        offset = int(offset_raw) if offset_raw not in (None, "") else 0
    except (TypeError, ValueError):
        raise InvalidRequestError("limit y offset deben ser números")
    if limit < 1 or limit > PAGE_MAX or offset < 0:
        raise InvalidRequestError(f"limit debe estar entre 1 y {PAGE_MAX} y offset no puede ser negativo")
    return limit, offset


def _iso(value):
    return value.isoformat() if value else None


#: Tipo interno -> valor de `?type=` que ve el cliente.
_TYPE_NAMES = {subjects.MEDIA_ATTACHMENT: "media", subjects.STORY: "story", subjects.VIDEO: "video"}


def _present_item(row, subject_type=subjects.MEDIA_ATTACHMENT):
    return {
        "id": str(row["id"]),
        "type": _TYPE_NAMES[subject_type],
        "status": row["status"],
        "parent_type": row["parent_type"],
        "owner": {"id": str(row["owner_id"]), "username": row["owner_username"]},
        "priority": row["priority"] or "normal",
        "reason": row["reason"],
        "scores": row["scores"] or {},
        "restricted": bool(row["restricted"]),
        "created_at": _iso(row["created_at"]),
        "classified_at": _iso(row["classified_at"]),
        "decided_by": row["moderation_decided_by"],
        "decided_at": _iso(row["moderation_decided_at"]),
    }


def list_queue(tab, limit_raw, offset_raw, role, queue, subject_type=subjects.MEDIA_ATTACHMENT):
    statuses = STATUS_TABS.get(tab or "held")
    if statuses is None:
        raise InvalidRequestError("status inválido")
    limit, offset = _page(limit_raw, offset_raw)
    items, has_more = queue.list_items(
        statuses, limit, offset, roles.can_see_restricted(role), subject_type=subject_type
    )
    return {"items": [_present_item(i, subject_type) for i in items], "has_more": has_more}


def get_detail(attachment_id, role, queue, subject_type=subjects.MEDIA_ATTACHMENT):
    item = queue.get_item(attachment_id, subject_type)
    # Lo restringido es, para un reviewer, indistinguible de lo inexistente.
    if item is None or (item["restricted"] and not roles.can_see_restricted(role)):
        raise NotFoundError()
    return {
        **_present_item(item, subject_type),
        "results": [
            {"provider": r["provider"], "model_version": r["model_version"],
             "categories": r["categories"], "scores": r["scores"], "decision": r["decision"],
             "priority": r["priority"], "policy_version": r["policy_version"],
             "created_at": _iso(r["created_at"])}
            for r in queue.results_for(attachment_id)
        ],
        "trail": [
            {"action": t["action"], "actor_kind": t["actor_kind"],
             "actor": t["actor_username"], "changes": t["changes"], "at": _iso(t["created_at"])}
            for t in queue.trail_for(attachment_id, subject_type)
        ],
    }


def decide(attachment_id, actor_id, new_status, note, role, queue, repository, user_repository, now,
           subject_type=subjects.MEDIA_ATTACHMENT):
    item = queue.get_item(attachment_id, subject_type)
    if item is not None and item["restricted"] and not roles.can_see_restricted(role):
        raise NotFoundError()
    if note is not None and (not isinstance(note, str) or len(note) > MAX_NOTE):
        raise InvalidRequestError(f"La nota no puede superar {MAX_NOTE} caracteres")
    try:
        return human_decision.decide_attachment(
            attachment_id, actor_id, new_status, note, repository, user_repository, now,
            subject_type=subject_type,
        )
    except human_decision.NotAllowedError:
        raise NotFoundError()
    except human_decision.InvalidDecisionError:
        raise InvalidRequestError("decision debe ser approved, held o rejected")
    except human_decision.NotFoundError:
        raise NotFoundError()


def audit_page(limit_raw, offset_raw, queue):
    limit, offset = _page(limit_raw, offset_raw)
    rows, has_more = queue.audit_page(limit, offset)
    return {
        "items": [
            {"id": str(r["id"]), "action": r["action"], "actor_kind": r["actor_kind"],
             "actor": r["actor_username"], "resource_type": r["resource_type"],
             "resource_id": str(r["resource_id"]) if r["resource_id"] else None,
             "changes": r["changes"], "at": _iso(r["created_at"])}
            for r in rows
        ],
        "has_more": has_more,
    }


def list_jobs(tab, limit_raw, offset_raw, queue):
    statuses = JOB_TABS.get(tab or "all")
    if statuses is None:
        raise InvalidRequestError("status inválido")
    limit, offset = _page(limit_raw, offset_raw)
    rows, has_more = queue.list_jobs(statuses, limit, offset)
    return {
        "items": [
            {"id": str(r["id"]), "kind": r["kind"], "subject_type": r["subject_type"],
             "subject_id": str(r["subject_id"]), "status": r["status"], "attempts": r["attempts"],
             "last_error": r["last_error"], "next_attempt_at": _iso(r["next_attempt_at"]),
             "created_at": _iso(r["created_at"]), "finished_at": _iso(r["finished_at"])}
            for r in rows
        ],
        "has_more": has_more,
    }


def retry_job(job_id, actor_id, queue, repository, now):
    row = queue.retry_job(job_id, now)
    if row is None:
        raise NotFoundError()
    repository.audit(actor_id, status.ACTOR_KIND_HUMAN, "moderation_job_retried", "moderation_job",
                     job_id, {"to": "queued"})
    repository.commit()
    return {"id": str(job_id), "status": "queued"}


def stats(role, queue):
    return queue.stats(roles.can_see_restricted(role))


# --- Apelaciones -------------------------------------------------------------------------------


def create_appeal(user_id, attachment_id, reason, queue, repository,
                  subject_type=subjects.MEDIA_ATTACHMENT, events=None):
    if not isinstance(reason, str) or not 1 <= len(reason.strip()) <= MAX_REASON:
        raise InvalidRequestError(f"El motivo debe tener entre 1 y {MAX_REASON} caracteres")
    attachment = queue.attachment_for_appeal(attachment_id, subject_type)
    # Solo se apela lo propio y lo que está retenido o rechazado; todo lo demás es un 404
    # indistinguible, para no revelar si el contenido de otra persona existe.
    if attachment is None or str(attachment["owner_id"]) != str(user_id) \
            or attachment["moderation_status"] not in APPEALABLE:
        raise NotFoundError()
    if queue.count_open_appeals(user_id) >= MAX_OPEN_APPEALS:
        raise TooManyAppealsError()
    created = queue.create_appeal(
        user_id, attachment_id, reason.strip(), attachment["moderation_decided_by"],
        subject_type=subject_type,
    )
    if created is None:
        repository.rollback()
        raise ConflictError("Ya tienes una apelación abierta para este contenido")
    repository.audit(user_id, status.ACTOR_KIND_HUMAN, "moderation_appeal_opened",
                     subject_type, attachment_id, {"appeal_id": str(created["id"])})
    if events is not None:
        events.enqueue("moderation.appeal_opened",
                       {"appeal_id": str(created["id"]), "subject_type": subject_type},
                       created["id"])
    repository.commit()
    return {"id": str(created["id"]), "status": "open", "target_hours": APPEAL_TARGET_HOURS}


def my_appeals(user_id, queue):
    return {
        "appeals": [
            {"id": str(a["id"]), "attachment_id": str(a["attachment_id"]), "status": a["status"],
             "type": _TYPE_NAMES.get(a["subject_type"], "media"),
             "resolution_note": a["resolution_note"], "created_at": _iso(a["created_at"]),
             "resolved_at": _iso(a["resolved_at"])}
            for a in queue.my_appeals(user_id)
        ]
    }


def list_appeals(tab, limit_raw, offset_raw, role, queue):
    state = tab or "open"
    if state not in ("open", "upheld", "overturned"):
        raise InvalidRequestError("status inválido")
    limit, offset = _page(limit_raw, offset_raw)
    rows, has_more = queue.list_appeals(state, limit, offset, roles.can_see_restricted(role))
    return {
        "items": [
            {"id": str(a["id"]), "attachment_id": str(a["attachment_id"]), "status": a["status"],
             "type": _TYPE_NAMES.get(a["subject_type"], "media"),
             "reason": a["reason"], "appellant": a["appellant"], "overdue": bool(a["overdue"]),
             "due_at": _iso(a["due_at"]), "created_at": _iso(a["created_at"]),
             "resolved_at": _iso(a["resolved_at"]), "resolution_note": a["resolution_note"]}
            for a in rows
        ],
        "has_more": has_more,
        "target_hours": APPEAL_TARGET_HOURS,
    }


def resolve_appeal(appeal_id, reviewer_id, outcome, note, role, queue, repository, now):
    if outcome not in ("upheld", "overturned"):
        raise InvalidRequestError("outcome debe ser upheld u overturned")
    if note is not None and (not isinstance(note, str) or len(note) > MAX_NOTE):
        raise InvalidRequestError(f"La nota no puede superar {MAX_NOTE} caracteres")

    appeal = queue.lock_appeal(appeal_id)
    if appeal is None:
        repository.rollback()
        raise NotFoundError()
    appeal_type = appeal["subject_type"]
    item = queue.get_item(appeal["subject_id"], appeal_type)
    if item is not None and item["restricted"] and not roles.can_see_restricted(role):
        repository.rollback()
        raise NotFoundError()
    if appeal["status"] != "open":
        repository.rollback()
        raise ConflictError("Esta apelación ya fue resuelta")
    # Distinta persona (ADR-044 decisión 4). La base lo impide también (CHECK), pero se responde
    # con un error claro antes de llegar ahí.
    if appeal["original_decided_by"] == str(reviewer_id):
        repository.rollback()
        raise ForbiddenError("No puedes revisar una apelación de tu propia decisión")
    if str(appeal["user_id"]) == str(reviewer_id):
        repository.rollback()
        raise ForbiddenError("No puedes revisar tu propia apelación")

    if outcome == "overturned":
        queue_previous = repository.set_status_human(
            appeal["subject_id"], status.APPROVED, reviewer_id, now, subject_type=appeal_type
        )
        if queue_previous is None:
            repository.rollback()
            raise NotFoundError()
    queue.resolve_appeal(appeal_id, outcome, reviewer_id, (note or "").strip() or None, now)
    repository.audit(
        reviewer_id, status.ACTOR_KIND_HUMAN, "moderation_appeal_resolved", appeal_type,
        appeal["subject_id"], {"appeal_id": str(appeal_id), "outcome": outcome,
                               "note": (note or "").strip()[:300] or None},
    )
    repository.commit()
    return {"id": str(appeal_id), "status": outcome}
