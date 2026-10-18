# Rutas internas para n8n (ADR-044 §2.8): n8n -> Flask. Alcance MÍNIMO y solo lectura de agregados
# más la creación de avisos. NO existe ninguna ruta interna para aprobar, rechazar, sancionar, leer
# contenido ni escribir un estado de moderación: lo que n8n no puede pedir, no puede hacerse.
#
# Autenticación: firma HMAC-SHA256 del cuerpo con marca de tiempo (`X-Thers-Signature`), secreto
# distinto del de salida. Sin secreto configurado, o con n8n apagado, estas rutas no existen (404).
# Una firma mala o vieja recibe el mismo 404: no se anuncia que la ruta está ahí.

import time
from functools import wraps

from flask import Blueprint, current_app, jsonify, request

from app.application.rate_limiting import rate_limit_guard
from app.domain.automation import events
from app.domain.rate_limiting import policy
from app.domain.rate_limiting.exceptions import RateLimitExceededError
from app.infrastructure.persistence.repositories.moderation_queue_repository import (
    SQLAlchemyModerationQueueRepository,
)
from app.infrastructure.persistence.repositories.rate_limit_repository import (
    SQLAlchemyRateLimitRepository,
)
from app.interfaces.rate_limited_response import rate_limited_response

internal_bp = Blueprint("internal", __name__)

_queue = SQLAlchemyModerationQueueRepository()
_rate_limit_repository = SQLAlchemyRateLimitRepository()

#: Avisos que n8n puede pedir (la lista es cerrada; cada uno corresponde a un asunto del correo).
NOTICE_KINDS = ("backlog", "appeal_overdue", "job_dead")


def _not_found():
    return jsonify({"msg": "Recurso no encontrado"}), 404


def signed_request_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        config = current_app.config
        secret = config.get("N8N_INBOUND_SECRET")
        if not config.get("N8N_ENABLED") or not secret:
            return _not_found()
        header = request.headers.get(events.SIGNATURE_HEADER)
        if not events.verify(secret, header, request.get_data(), time.time()):
            return _not_found()
        return view(*args, **kwargs)

    return wrapper


@internal_bp.route("/internal/moderation/summary", methods=["GET"])
@signed_request_required
def summary():
    """Solo conteos. Incluye lo restringido porque son números, no contenido."""
    stats = _queue.stats(can_see_restricted=True)
    return jsonify({
        "held": stats["by_status"].get("held", 0),
        "pending": stats["by_status"].get("pending", 0),
        "critical_held": stats["held_by_priority"].get("critical", 0),
        "jobs_failed": stats["jobs_by_status"].get("failed", 0),
        "jobs_dead": stats["jobs_by_status"].get("dead", 0),
        "appeals_open": stats["appeals"]["open"],
        "appeals_overdue": stats["appeals"]["overdue"],
    }), 200


@internal_bp.route("/internal/notices", methods=["POST"])
@signed_request_required
def notice():
    data = request.get_json(silent=True) or {}
    kind = data.get("kind")
    if kind not in NOTICE_KINDS:
        return jsonify({"msg": "kind inválido"}), 400
    try:
        rate_limit_guard.enforce(policy.INTERNAL_NOTICE, "internal", _rate_limit_repository)
    except RateLimitExceededError as error:
        return rate_limited_response(error)
    alerter = current_app.extensions.get("team_alerter")
    delivered = bool(alerter and alerter.alert(kind))
    return jsonify({"delivered": delivered}), 200
