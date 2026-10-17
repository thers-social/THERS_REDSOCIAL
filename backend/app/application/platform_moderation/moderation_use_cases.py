# Casos de uso de la moderación de la plataforma (ADR-032 §3, fase 2).
#
# `moderator_id` sale SIEMPRE del JWT en la route, nunca del cuerpo.

import uuid

from app.domain.platform_moderation import actions
from app.domain.platform_moderation.exceptions import (
    ActionNotApplicableError,
    CannotModerateSelfError,
    InvalidModerationRequestError,
    ModerationReportNotFoundError,
    ReportAlreadyResolvedError,
)
from app.domain.reports import kinds

_CLOSED = (kinds.STATUS_ACTIONED, kinds.STATUS_DISMISSED)


def to_moderation_report(report, reported_user, reports_on_target):
    """Lo que ve quien modera de un reporte.

    **Nunca** incluye quién reportó (`reporter_id`): quien modera decide sobre lo
    reportado, no sobre la persona que lo denunció, y mantener esa identidad
    fuera de la API es una garantía de ADR-032 §2. Tampoco el correo ni los
    datos privados de la cuenta reportada."""
    return {
        "id": str(report.id),
        "target_type": report.target_type,
        "target_id": str(report.target_id),
        "reason": report.reason,
        "priority": report.priority,
        "status": report.status,
        "details": report.details,
        # Solo existe mientras el reporte está abierto (ADR-032 §4).
        "content_snapshot": report.content_snapshot,
        "reports_on_target": reports_on_target,
        "reported_user": (
            None
            if reported_user is None
            else {
                "id": str(reported_user.id),
                "username": reported_user.username,
                "name": reported_user.name,
                "suspended": reported_user.suspended_at is not None,
                "is_moderator": reported_user.is_moderator,
            }
        ),
        "created_at": report.created_at.isoformat(),
        "resolved_at": report.resolved_at.isoformat() if report.resolved_at else None,
        "resolution_note": report.resolution_note,
    }


def _parse_page(limit, offset):
    try:
        limit = actions.DEFAULT_PAGE_SIZE if limit is None else int(limit)
        offset = 0 if offset is None else int(offset)
    except (TypeError, ValueError):
        raise InvalidModerationRequestError("limit y offset deben ser enteros")
    if not 1 <= limit <= actions.MAX_PAGE_SIZE:
        raise InvalidModerationRequestError(
            f"limit debe estar entre 1 y {actions.MAX_PAGE_SIZE}"
        )
    if offset < 0:
        raise InvalidModerationRequestError("offset no puede ser negativo")
    return limit, offset


def list_reports(status, limit, offset, moderation_repository):
    status = actions.DEFAULT_QUEUE_STATUS if status is None else status
    if status not in actions.QUEUE_STATUSES:
        raise InvalidModerationRequestError("El estado indicado no es válido")
    limit, offset = _parse_page(limit, offset)

    reports, has_more = moderation_repository.list_reports(status, limit, offset)
    counts = moderation_repository.count_reports_by_target(
        sorted({(r.target_type, r.target_id) for r in reports}, key=str)
    )

    items = []
    for report in reports:
        reported = (
            moderation_repository.get_user(report.reported_user_id)
            if report.reported_user_id
            else None
        )
        items.append(
            to_moderation_report(
                report, reported, counts.get((report.target_type, str(report.target_id)), 1)
            )
        )
    return items, has_more


def _validate_resolution(action, note, reason):
    if action not in actions.ACTIONS:
        raise InvalidModerationRequestError("La acción no es válida")

    if note is not None:
        if not isinstance(note, str):
            raise InvalidModerationRequestError("La nota no es válida")
        note = note.strip() or None
        if note is not None and len(note) > actions.MAX_NOTE_LENGTH:
            raise InvalidModerationRequestError(
                f"La nota no puede superar {actions.MAX_NOTE_LENGTH} caracteres"
            )

    if reason is not None:
        if action != actions.ACTION_SUSPEND_USER:
            raise InvalidModerationRequestError("El motivo solo se usa al suspender una cuenta")
        if not isinstance(reason, str):
            raise InvalidModerationRequestError("El motivo no es válido")
        reason = reason.strip() or None
        if reason is not None and len(reason) > actions.MAX_SUSPENSION_REASON_LENGTH:
            raise InvalidModerationRequestError(
                f"El motivo no puede superar {actions.MAX_SUSPENSION_REASON_LENGTH} caracteres"
            )

    return action, note, reason


def _remove_content(
    report, post_repository, comment_repository, message_repository, review_repository=None
):
    """Retira el contenido reportado con las rutas de borrado que ya existen
    (ADR-019/ADR-020). Si el autor ya no existe, el contenido se fue con su
    cuenta (`ON DELETE CASCADE`, ADR-031) y no hay nada que borrar."""
    owner_id = report.reported_user_id
    if owner_id is None:
        return

    deleters = {
        kinds.TARGET_POST: post_repository.delete,
        kinds.TARGET_COMMENT: comment_repository.delete,
        kinds.TARGET_MESSAGE: message_repository.delete,
    }
    if review_repository is not None:
        # Reseñas de lugares (ADR-040 fase 4a.2): el borrado es por id y autor.
        deleters[kinds.TARGET_REVIEW] = review_repository.delete_review_by_id
    # Devuelve `False` si ya no existía (el autor lo borró antes): el resultado que
    # se quería, así que no es un error.
    deleters[report.target_type](report.target_id, owner_id)


def resolve_report(
    moderator_id,
    report_id,
    action,
    note,
    reason,
    moderation_repository,
    post_repository,
    comment_repository,
    message_repository,
    session_repository,
    refresh_token_repository,
    review_repository=None,
):
    action, note, reason = _validate_resolution(action, note, reason)

    try:
        report_id = str(uuid.UUID(str(report_id)))
    except ValueError:
        raise ModerationReportNotFoundError()

    report = moderation_repository.get_report_for_update(report_id)
    if report is None:
        raise ModerationReportNotFoundError()
    if report.status in _CLOSED:
        raise ReportAlreadyResolvedError()

    # ADR-032 §3: quien modera no puede resolver un reporte sobre sí mismo.
    if report.reported_user_id is not None and str(report.reported_user_id) == str(moderator_id):
        raise CannotModerateSelfError()

    if action == actions.ACTION_DISMISS:
        moderation_repository.close_report(report, kinds.STATUS_DISMISSED, moderator_id, note)

    elif action == actions.ACTION_REMOVE_CONTENT:
        if report.target_type == kinds.TARGET_USER:
            raise ActionNotApplicableError(
                "Un reporte sobre una cuenta no tiene contenido que retirar; suspende la cuenta"
            )
        _remove_content(
            report, post_repository, comment_repository, message_repository, review_repository
        )
        moderation_repository.close_report(report, kinds.STATUS_ACTIONED, moderator_id, note)
        # El contenido ya no existe: los demás reportes sobre él no tienen nada más que revisar.
        moderation_repository.close_other_reports_on_target(
            report, moderator_id, "Contenido retirado al resolver otro reporte"
        )

    else:  # ACTION_SUSPEND_USER
        if report.reported_user_id is None:
            raise ActionNotApplicableError("La cuenta ya no existe")
        target = moderation_repository.get_user(report.reported_user_id)
        if target is None:
            raise ActionNotApplicableError("La cuenta ya no existe")
        if target.is_moderator:
            # Una cuenta de moderador comprometida podría suspender a todo el equipo
            # (ADR-032 §Riesgos): el rol se retira por línea de comandos primero.
            raise ActionNotApplicableError(
                "No se puede suspender a una cuenta moderadora desde el panel"
            )

        moderation_repository.suspend_user(target.id, reason or actions.DEFAULT_SUSPENSION_REASON)
        # Las sesiones dejan de valer YA, no cuando venza el access token de 15 minutos.
        session_repository.revoke_all_for_user(target.id)
        refresh_token_repository.revoke_all_for_user(target.id)
        moderation_repository.close_report(report, kinds.STATUS_ACTIONED, moderator_id, note)

    return {"id": str(report.id), "status": report.status, "action": action}
