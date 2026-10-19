# Casos de uso de los reportes (ADR-032-content-reports-and-moderation.md §2).

import uuid

from app.application.privacy.post_visibility import assert_post_visible
from app.domain.posts.exceptions import PostNotFoundError
from app.domain.reports import kinds
from app.domain.reports.exceptions import (
    CannotReportSelfError,
    InvalidReportError,
    ReportTargetNotFoundError,
)


def to_public_report(report, already_reported):
    """Lo que se le devuelve a quien reporta.

    **Nunca** incluye `reporter_id`, `reported_user_id` ni el texto copiado: quien
    reporta no necesita nada de eso, y mantenerlo fuera de las respuestas es una
    de las garantías de ADR-032 (la persona reportada jamás se entera de quién
    fue). Mismo criterio que `to_public_restriction` (ADR-029)."""
    return {
        "id": str(report.id),
        "target_type": report.target_type,
        "target_id": str(report.target_id),
        "reason": report.reason,
        "status": report.status,
        # ADR-038: lo que ve quien reportó de su propio reporte. La decide el servidor.
        "priority": report.priority,
        "created_at": report.created_at.isoformat(),
        "already_reported": already_reported,
    }


def _validate(target_type, target_id, reason, details):
    """Valida y normaliza el cuerpo. Devuelve `(tipo, uuid, motivo, detalle)`."""
    if target_type not in kinds.TARGET_TYPES:
        raise InvalidReportError("El tipo de lo que quieres reportar no es válido")

    try:
        target_uuid = str(uuid.UUID(str(target_id)))
    except ValueError:
        raise InvalidReportError("El identificador de lo que quieres reportar no es válido")

    if reason not in kinds.REASONS:
        raise InvalidReportError("El motivo del reporte no es válido")

    if details is not None:
        if not isinstance(details, str):
            raise InvalidReportError("El detalle del reporte no es válido")
        details = details.strip() or None
        if details is not None and len(details) > kinds.MAX_DETAILS_LENGTH:
            raise InvalidReportError(
                f"El detalle no puede superar {kinds.MAX_DETAILS_LENGTH} caracteres"
            )

    return target_type, target_uuid, reason, details


def _assert_visible(
    target, reporter_id, follow_repository, restriction_repository, close_friend_repository=None
):
    """Lanza `ReportTargetNotFoundError` si `reporter_id` no puede ver el
    objetivo. **Solo se puede reportar lo que se puede ver** (ADR-032 §2):
    reportar no debe servir para confirmar que algo existe ni de quién es.

    Reutiliza las guardias que ya protegen la lectura (ADR-022/ADR-029) en vez de
    inventar reglas nuevas, así que un cambio de visibilidad se propaga solo."""
    if target.target_type in (kinds.TARGET_POST, kinds.TARGET_COMMENT):
        try:
            assert_post_visible(
                target.post, reporter_id, follow_repository, restriction_repository,
                close_friend_repository,
            )
        except PostNotFoundError:
            raise ReportTargetNotFoundError()

    if target.target_type == kinds.TARGET_MESSAGE:
        # Un mensaje lo reporta solo quien lo recibió. El remitente ya sabe lo
        # que escribió, y un tercero no tiene por qué ver una conversación ajena.
        if target.group_member_ids is not None:
            # En un grupo (ADR-048) lo puede reportar cualquier miembro menos su autor.
            if str(reporter_id) not in target.group_member_ids or str(reporter_id) == str(target.owner_id):
                raise ReportTargetNotFoundError()
        elif str(target.recipient_id) != str(reporter_id):
            raise ReportTargetNotFoundError()

    # Un bloqueo en cualquier sentido oculta a esa cuenta (ADR-029): su
    # comentario, su mensaje y su perfil dejan de existir para quien reporta.
    if target.target_type != kinds.TARGET_POST and restriction_repository.is_blocked_between(
        reporter_id, target.owner_id
    ):
        raise ReportTargetNotFoundError()


def create_report(
    reporter_id,
    target_type,
    target_id,
    reason,
    details,
    target_resolver,
    report_repository,
    follow_repository,
    restriction_repository,
    close_friend_repository=None,
):
    target_type, target_id, reason, details = _validate(target_type, target_id, reason, details)

    target = target_resolver.resolve(target_type, target_id)
    if target is None:
        raise ReportTargetNotFoundError()

    # Primero la visibilidad, después "es mío": si fuera al revés, el 400 de
    # "no puedes reportarte" confirmaría que algo existe y es de esa persona.
    _assert_visible(
        target, reporter_id, follow_repository, restriction_repository, close_friend_repository
    )

    if str(target.owner_id) == str(reporter_id):
        raise CannotReportSelfError()

    report, created = report_repository.create_if_absent(
        reporter_id=reporter_id,
        target_type=target.target_type,
        target_id=target.target_id,
        reported_user_id=target.owner_id,
        reason=reason,
        details=details,
        snapshot=(target.text or "")[: kinds.MAX_SNAPSHOT_LENGTH] or None,
        # La prioridad sale del motivo, en el servidor: nunca del cuerpo de la petición.
        priority=kinds.priority_for_reason(reason),
    )

    return to_public_report(report, already_reported=not created), created
