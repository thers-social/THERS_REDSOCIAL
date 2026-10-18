# Rutas de moderación de la plataforma (ADR-032-content-reports-and-moderation.md §3,
# fase 2). Solo para cuentas con `is_moderator`; cualquier otra recibe un 404.
#
# OJO con los nombres: no confundir con los filtros personales de cada persona
# (palabras y temas silenciados, ADR-024), que viven en `domain/moderation`.

from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity

from app.application.media.attachments import discard_files
from app.application.platform_moderation.moderation_use_cases import (
    list_reports,
    resolve_report,
)
from app.domain.platform_moderation.exceptions import (
    ActionNotApplicableError,
    CannotModerateSelfError,
    InvalidModerationRequestError,
    ModerationReportNotFoundError,
    ReportAlreadyResolvedError,
)
from app.infrastructure.persistence.repositories.comment_repository import (
    SQLAlchemyCommentRepository,
)
from app.infrastructure.persistence.repositories.place_repository import (
    SQLAlchemyPlaceRepository,
)
from app.infrastructure.persistence.repositories.message_repository import (
    SQLAlchemyMessageRepository,
)
from app.infrastructure.persistence.repositories.moderation_repository import (
    SQLAlchemyModerationRepository,
)
from app.infrastructure.persistence.repositories.post_repository import (
    SQLAlchemyPostRepository,
)
from app.infrastructure.persistence.repositories.refresh_token_repository import (
    SQLAlchemyRefreshTokenRepository,
)
from app.infrastructure.persistence.repositories.session_repository import (
    SQLAlchemySessionRepository,
)
from app.application.automations.notifier import AutomationNotifier
from app.infrastructure.automations.factory import automation_state
from app.infrastructure.persistence.repositories.automation_repository import (
    SQLAlchemyAutomationRepository,
)
from app.interfaces.moderator_required import moderator_required

moderation_bp = Blueprint("platform_moderation", __name__)

_moderation_repository = SQLAlchemyModerationRepository()
_post_repository = SQLAlchemyPostRepository()
_comment_repository = SQLAlchemyCommentRepository()
_message_repository = SQLAlchemyMessageRepository()
_automation_repository = SQLAlchemyAutomationRepository()


def _notify_reporter(result):
    """Avisa a quien reportó (ADR-041 §7, n8n). De mejor esfuerzo: un fallo aquí NUNCA debe
    deshacer ni retrasar la resolución, que ya quedó guardada."""
    try:
        state = automation_state(current_app)
        AutomationNotifier(state["client"], state["runner"], _automation_repository).report_resolved(
            result["id"], result["status"]
        )
    except Exception as error:  # noqa: BLE001
        current_app.logger.warning("aviso de reporte resuelto falló (%s)", type(error).__name__)
_place_repository = SQLAlchemyPlaceRepository()


class _ReviewRemover:
    """Retira una reseña reportada y BORRA SUS ARCHIVOS (a diferencia de los otros tipos,
    que dejan huérfanos los suyos: limitación previa, aquí se evita desde el inicio)."""

    def delete_review_by_id(self, review_id, owner_id):
        keys = _place_repository.delete_review_by_id(review_id, owner_id)
        if keys is None:
            return False
        discard_files(keys, current_app.extensions["media_storage"])
        return True


_review_remover = _ReviewRemover()
_session_repository = SQLAlchemySessionRepository()
_refresh_token_repository = SQLAlchemyRefreshTokenRepository()


@moderation_bp.route("/moderation/reports", methods=["GET"])
@moderator_required
def get_reports():
    try:
        items, has_more = list_reports(
            request.args.get("status"),
            request.args.get("limit"),
            request.args.get("offset"),
            _moderation_repository,
        )
    except InvalidModerationRequestError as error:
        return jsonify({"msg": error.message}), 400

    return jsonify({"reports": items, "has_more": has_more}), 200


@moderation_bp.route("/moderation/reports/<report_id>/resolve", methods=["POST"])
@moderator_required
def post_resolve_report(report_id):
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"msg": "No se enviaron datos"}), 400

    # Whitelist explícita: `moderator_id` sale SOLO del JWT. Cualquier otro campo
    # del cuerpo (`status`, `resolved_by`…) se ignora.
    try:
        result = resolve_report(
            get_jwt_identity(),
            report_id,
            data.get("action"),
            data.get("note"),
            data.get("reason"),
            _moderation_repository,
            _post_repository,
            _comment_repository,
            _message_repository,
            _session_repository,
            _refresh_token_repository,
            _review_remover,
        )
    except InvalidModerationRequestError as error:
        return jsonify({"msg": error.message}), 400
    except ActionNotApplicableError as error:
        return jsonify({"msg": error.message}), 400
    except ModerationReportNotFoundError:
        return jsonify({"msg": "Reporte no encontrado"}), 404
    except ReportAlreadyResolvedError:
        return jsonify({"msg": "Este reporte ya fue resuelto"}), 409
    except CannotModerateSelfError:
        return jsonify({"msg": "No puedes resolver un reporte sobre tu propia cuenta"}), 403

    _notify_reporter(result)
    return jsonify({"report": result}), 200
