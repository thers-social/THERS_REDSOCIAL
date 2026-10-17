# Chat de Tero (ADR-041, fase 4). Exige sesión.
#
#   POST /api/tero/chat    cuerpo {message, history?: [{role, content}], context?: {screen,
#                          entity_type, entity_id}}  ->  {reply, source}
#
# `source` distingue una respuesta del modelo ("ai") de un texto fijo del sistema ("disabled",
# "budget", "refused"). Ningún error filtra el texto del proveedor, la clave ni la conversación.

from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.application.rate_limiting import rate_limit_guard
from app.application.tero import chat_service
from app.application.tero.settings import TeroSettings
from app.application.tero.tools import ToolDependencies
from app.domain.rate_limiting import policy
from app.domain.rate_limiting.exceptions import RateLimitExceededError
from app.domain.tero.chat import InvalidTeroRequestError, TeroUnavailableError
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
from app.infrastructure.persistence.repositories.tero_usage_repository import (
    SQLAlchemyTeroUsageRepository,
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
)


def _settings():
    config = current_app.config
    return TeroSettings(
        ai_enabled=config["TERO_AI_ENABLED"],
        tools_enabled=config["TERO_TOOLS_ENABLED"],
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

    try:
        result = chat_service.send_message(
            data, _settings(), tero_provider(current_app), _usage_repository,
            user_id=get_jwt_identity(), tool_deps=_tool_dependencies,
        )
    except InvalidTeroRequestError as error:
        return jsonify({"msg": error.message}), 400
    except TeroUnavailableError:
        # Nunca el texto del proveedor: solo un mensaje fijo.
        return jsonify({"msg": "Tero no está disponible ahora. Intenta más tarde."}), 503

    response = jsonify(result)
    response.headers["Cache-Control"] = "no-store"
    return response, 200
