# Chat de Tero (ADR-041, fases 4 a 6). Exige sesión.
#
#   POST /api/tero/chat                       cuerpo {message, history?, context?}
#                                             ->  {reply, source, confirmation_cards}
#   POST /api/tero/actions/<id>/confirm       confirma y EJECUTA una acción que Tero preparó
#   POST /api/tero/actions/<id>/cancel        la descarta
#
# `source` distingue una respuesta del modelo ("ai") de un texto fijo del sistema ("disabled",
# "budget", "refused"). `confirmation_cards` son acciones que Tero PREPARÓ y que NO se han hecho:
# solo `confirm`, llamada por la persona, las ejecuta. Ningún error filtra el texto del proveedor,
# la clave ni la conversación.

from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.application.rate_limiting import rate_limit_guard
from app.application.tero import actions as action_use_cases
from app.application.tero import chat_service
from app.application.tero.settings import TeroSettings
from app.application.tero.tools import ToolDependencies
from app.domain.rate_limiting import policy
from app.domain.rate_limiting.exceptions import RateLimitExceededError
from app.domain.tero import actions as action_rules
from app.domain.media.storage import ImageTooLargeError, InvalidImageError
from app.domain.tero import chat as chat_rules
from app.domain.tero.chat import InvalidTeroRequestError, TeroUnavailableError
from app.infrastructure.media.image_processor import process_for_ai
from app.infrastructure.ai.factory import tero_provider
from app.infrastructure.persistence.repositories.comment_repository import (
    SQLAlchemyCommentRepository,
)
from app.infrastructure.persistence.repositories.follow_repository import (
    SQLAlchemyFollowRepository,
)
from app.infrastructure.persistence.repositories.like_repository import SQLAlchemyLikeRepository
from app.infrastructure.persistence.repositories.mention_repository import (
    SQLAlchemyMentionRepository,
)
from app.infrastructure.persistence.repositories.muted_keyword_repository import (
    SQLAlchemyMutedKeywordRepository,
)
from app.infrastructure.persistence.repositories.notification_repository import (
    SQLAlchemyNotificationRepository,
)
from app.infrastructure.persistence.repositories.place_repository import SQLAlchemyPlaceRepository
from app.infrastructure.persistence.repositories.post_repository import SQLAlchemyPostRepository
from app.infrastructure.persistence.repositories.rate_limit_repository import (
    SQLAlchemyRateLimitRepository,
)
from app.infrastructure.persistence.repositories.restriction_repository import (
    SQLAlchemyRestrictionRepository,
)
from app.infrastructure.persistence.repositories.reservation_repository import (
    SQLAlchemyReservationRepository,
)
from app.infrastructure.persistence.repositories.suggestion_repository import (
    SQLAlchemySuggestionRepository,
)
from app.infrastructure.persistence.repositories.tero_usage_repository import (
    SQLAlchemyTeroUsageRepository,
)
from app.infrastructure.persistence.repositories.tero_action_repository import (
    SQLAlchemyTeroActionRepository,
)
from app.infrastructure.persistence.repositories.user_repository import SQLAlchemyUserRepository
from app.infrastructure.persistence.repositories.user_search_repository import (
    SQLAlchemyUserSearchRepository,
)
from app.interfaces.rate_limited_response import rate_limited_response

tero_bp = Blueprint("tero", __name__)

_rate_limit_repository = SQLAlchemyRateLimitRepository()
_usage_repository = SQLAlchemyTeroUsageRepository()

# Las herramientas de lectura (ADR-041 fase 5) usan los MISMOS repositorios que el resto de la app,
# para que apliquen las mismas reglas de privacidad, bloqueo y filtros.
_tool_dependencies = ToolDependencies(
    user_repository=SQLAlchemyUserRepository(),
    follow_repository=SQLAlchemyFollowRepository(),
    notification_repository=SQLAlchemyNotificationRepository(),
    restriction_repository=SQLAlchemyRestrictionRepository(),
    post_repository=SQLAlchemyPostRepository(),
    like_repository=SQLAlchemyLikeRepository(),
    comment_repository=SQLAlchemyCommentRepository(),
    mention_repository=SQLAlchemyMentionRepository(),
    muted_keyword_repository=SQLAlchemyMutedKeywordRepository(),
    place_repository=SQLAlchemyPlaceRepository(),
    user_search_repository=SQLAlchemyUserSearchRepository(),
    action_repository=SQLAlchemyTeroActionRepository(),
    suggestion_repository=SQLAlchemySuggestionRepository(),
    reservation_repository=SQLAlchemyReservationRepository(),
)


def _settings():
    config = current_app.config
    return TeroSettings(
        ai_enabled=config["TERO_AI_ENABLED"],
        tools_enabled=config["TERO_TOOLS_ENABLED"],
        actions_enabled=config["TERO_ACTIONS_ENABLED"],
        monthly_budget_micro=config["TERO_MONTHLY_BUDGET_MICRO"],
        price_in_micro=config["TERO_PRICE_INPUT_MICRO_PER_MTOK"],
        price_out_micro=config["TERO_PRICE_OUTPUT_MICRO_PER_MTOK"],
    )


@tero_bp.route("/tero/chat", methods=["POST"])
@jwt_required()
def chat():
    # Apagado total (TERO_ENABLED): ni siquiera cuenta contra el límite.
    if not current_app.config["TERO_ENABLED"]:
        return jsonify({"msg": "Tero no está disponible.", "code": "tero_disabled"}), 503

    try:
        rate_limit_guard.enforce(
            policy.TERO_CHAT, f"user:{get_jwt_identity()}", _rate_limit_repository
        )
    except RateLimitExceededError as error:
        return rate_limited_response(error)

    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"msg": "No se enviaron datos"}), 400

    # Imagen (ADR-046): apagada por defecto (cuesta y sale a un tercero). Con el interruptor apagado ni
    # siquiera se mira el archivo.
    prepared_image = None
    if data.get("image") is not None:
        if not current_app.config.get("TERO_IMAGES_ENABLED"):
            return jsonify(
                {"msg": "Tero todavía no puede ver imágenes.", "code": "tero_images_disabled"}
            ), 503
        try:
            rate_limit_guard.enforce(
                policy.IMAGE_UPLOAD, f"user:{get_jwt_identity()}", _rate_limit_repository
            )
        except RateLimitExceededError as error:
            return rate_limited_response(error)
        try:
            raw = chat_rules.parse_chat_request(data).image
            prepared_image = process_for_ai(raw)
        except InvalidTeroRequestError as error:
            return jsonify({"msg": error.message}), 400
        except (InvalidImageError, ImageTooLargeError):
            return jsonify({"msg": "La imagen debe ser JPEG, PNG o WebP válida"}), 400

    try:
        result = chat_service.send_message(
            data, _settings(), tero_provider(current_app), _usage_repository,
            user_id=get_jwt_identity(), tool_deps=_tool_dependencies,
            prepared_image=prepared_image,
        )
    except InvalidTeroRequestError as error:
        return jsonify({"msg": error.message}), 400
    except TeroUnavailableError:
        # Nunca el texto del proveedor: solo un mensaje fijo.
        return jsonify({"msg": "Tero no está disponible ahora. Intenta más tarde."}), 503

    response = jsonify(result)
    response.headers["Cache-Control"] = "no-store"
    return response, 200


def _actions_gate():
    """Respuesta de error si el módulo o las acciones están apagados; `None` si se puede seguir.
    Apagar las acciones también bloquea confirmar propuestas ya hechas."""
    if not current_app.config["TERO_ENABLED"]:
        return jsonify({"msg": "Tero no está disponible.", "code": "tero_disabled"}), 503
    if not current_app.config["TERO_ACTIONS_ENABLED"]:
        return jsonify({"msg": "Las acciones de Tero no están disponibles.", "code": "tero_actions_disabled"}), 503
    return None


def _limited(user_id):
    try:
        rate_limit_guard.enforce(policy.TERO_ACTION, f"user:{user_id}", _rate_limit_repository)
    except RateLimitExceededError as error:
        return rate_limited_response(error)
    return None


def _action_error(error):
    if isinstance(error, action_rules.ActionNotFoundError):
        return jsonify({"msg": "Acción no encontrada"}), 404
    if isinstance(error, action_rules.ActionExpiredError):
        return jsonify({
            "msg": "La acción venció. Pídele a Tero que la prepare de nuevo.",
            "code": "action_expired",
        }), 409
    if isinstance(error, action_rules.ActionNotPendingError):
        return jsonify({
            "msg": "Esta acción ya no está pendiente.", "code": f"action_{error.status}",
        }), 409
    return jsonify({"msg": "No se pudo completar la acción.", "code": "action_failed"}), 409


@tero_bp.route("/tero/actions/<uuid:action_id>/confirm", methods=["POST"])
@jwt_required()
def confirm_action(action_id):
    gate = _actions_gate()
    if gate:
        return gate
    # La identidad es SIEMPRE el JWT: el cuerpo de la petición no se lee.
    user_id = get_jwt_identity()
    limited = _limited(user_id)
    if limited:
        return limited
    try:
        result = action_use_cases.confirm(user_id, action_id, _tool_dependencies)
    except (
        action_rules.ActionNotFoundError, action_rules.ActionExpiredError,
        action_rules.ActionNotPendingError, action_rules.ActionExecutionError,
    ) as error:
        return _action_error(error)
    response = jsonify(result)
    response.headers["Cache-Control"] = "no-store"
    return response, 200


@tero_bp.route("/tero/actions/<uuid:action_id>/cancel", methods=["POST"])
@jwt_required()
def cancel_action(action_id):
    gate = _actions_gate()
    if gate:
        return gate
    user_id = get_jwt_identity()
    limited = _limited(user_id)
    if limited:
        return limited
    try:
        result = action_use_cases.cancel(
            user_id, action_id, _tool_dependencies.action_repository
        )
    except (action_rules.ActionNotFoundError, action_rules.ActionNotPendingError) as error:
        return _action_error(error)
    response = jsonify(result)
    response.headers["Cache-Control"] = "no-store"
    return response, 200
