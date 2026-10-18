# Decisión humana sobre una imagen (ADR-044 §2.5). La autorización se comprueba AQUÍ, contra la
# base, y no en la interfaz: ocultar un botón no es un control (ADR-044 §2.6).

from app.domain.content_moderation import roles, status

AUDIT_ACTION = "moderation_human_decision"
AUDIT_RESOURCE = "media_attachment"


class NotAllowedError(Exception):
    """Quien intenta decidir no tiene el rol de moderación."""


class InvalidDecisionError(Exception):
    """El estado pedido no es una decisión humana válida."""


class NotFoundError(Exception):
    pass


def decide_attachment(attachment_id, actor_id, new_status, note, repository, user_repository, now):
    actor = user_repository.find_by_id(actor_id)
    role = None if actor is None else roles.effective_role(
        actor.is_moderator, actor.moderation_role, actor.suspended_at is not None
    )
    if role is None:
        raise NotAllowedError()
    if new_status not in status.HUMAN:
        raise InvalidDecisionError()

    previous = repository.set_status_human(attachment_id, new_status, actor_id, now)
    if previous is None:
        repository.rollback()
        raise NotFoundError()
    repository.audit(
        actor_id, status.ACTOR_KIND_HUMAN, AUDIT_ACTION, AUDIT_RESOURCE, attachment_id,
        {"from": previous, "to": new_status, "note": (note or "")[:300] or None},
    )
    repository.commit()
    return {"id": str(attachment_id), "from": previous, "to": new_status}
