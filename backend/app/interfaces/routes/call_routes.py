# Llamadas y videollamadas 1 a 1 por LiveKit (POST /api/calls, GET /api/calls/incoming, ...).
# Apagado por defecto (CALLS_ENABLED): sin LiveKit configurado todo responde 503 `calls_disabled`.
# El audio y el video no pasan por la API; aquí solo se coordina quién llama a quién y se entrega el
# token de sala de LiveKit. La identidad sale SIEMPRE del JWT, nunca del cuerpo.

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.application.calls.call_use_cases import (
    accept_call,
    cancel_call,
    decline_call,
    end_call,
    get_call,
    incoming_call,
    start_call,
)
from app.application.rate_limiting import rate_limit_guard
from app.domain.auth.exceptions import UserNotFoundError
from app.domain.calls.exceptions import (
    CallNotAllowedError,
    CallNotFoundError,
    CallsDisabledError,
    CallStateError,
    CannotCallSelfError,
    UserBusyError,
)
from app.domain.calls.status import KINDS
from app.domain.rate_limiting import policy
from app.domain.rate_limiting.exceptions import RateLimitExceededError
from app.domain.restrictions.exceptions import AccountBlockedError
from app.infrastructure.persistence.repositories.call_repository import SQLAlchemyCallRepository
from app.infrastructure.persistence.repositories.follow_repository import (
    SQLAlchemyFollowRepository,
)
from app.infrastructure.persistence.repositories.rate_limit_repository import (
    SQLAlchemyRateLimitRepository,
)
from app.infrastructure.persistence.repositories.restriction_repository import (
    SQLAlchemyRestrictionRepository,
)
from app.infrastructure.persistence.repositories.user_repository import SQLAlchemyUserRepository
from app.interfaces.profile_gate import profile_completed_required
from app.interfaces.rate_limited_response import rate_limited_response

calls_bp = Blueprint("calls", __name__)

_user_repository = SQLAlchemyUserRepository()
_call_repository = SQLAlchemyCallRepository()
_follow_repository = SQLAlchemyFollowRepository()
_restriction_repository = SQLAlchemyRestrictionRepository()
_rate_limit_repository = SQLAlchemyRateLimitRepository()


def _disabled():
    return jsonify({"msg": "Las llamadas no están disponibles ahora", "code": "calls_disabled"}), 503


def _not_found():
    return jsonify({"msg": "Llamada no encontrada"}), 404


def _bad_state():
    return jsonify({"msg": "La llamada ya no está disponible", "code": "call_state"}), 409


@calls_bp.route("/calls", methods=["POST"])
@jwt_required()
@profile_completed_required
def create():
    caller_id = get_jwt_identity()
    data = request.get_json(silent=True) or {}

    # Whitelist: solo `user_id` y `kind`; el que llama es siempre quien tiene la sesión.
    callee_id = data.get("user_id")
    kind = data.get("kind")
    if not isinstance(callee_id, str) or kind not in KINDS:
        return jsonify({"msg": "Indica user_id y kind ('audio' o 'video')"}), 400

    try:
        rate_limit_guard.enforce(policy.CALL_START, f"user:{caller_id}", _rate_limit_repository)
    except RateLimitExceededError as error:
        return rate_limited_response(error)

    try:
        result = start_call(
            caller_id, callee_id, kind, _user_repository, _call_repository,
            _follow_repository, _restriction_repository,
        )
    except CallsDisabledError:
        return _disabled()
    except CannotCallSelfError:
        return jsonify({"msg": "No puedes llamarte a ti mismo"}), 400
    except UserNotFoundError:
        return jsonify({"msg": "Usuario no encontrado"}), 404
    except AccountBlockedError:
        return jsonify({"msg": "Tienes bloqueada a esta cuenta. Desbloquéala para llamarle."}), 409
    except CallNotAllowedError:
        return jsonify({"msg": "Esta persona no acepta mensajes ni llamadas tuyas"}), 403
    except UserBusyError:
        return jsonify({"msg": "Ya hay una llamada en curso", "code": "busy"}), 409

    return jsonify(result), 201


@calls_bp.route("/calls/incoming", methods=["GET"])
@jwt_required()
def incoming():
    # Lo consulta el cliente cada pocos segundos (no hay tiempo real): se mantiene barato y sin errores
    # si las llamadas están apagadas, para no llenar de fallos a quien no las usa.
    call = incoming_call(get_jwt_identity(), _user_repository, _call_repository)
    return jsonify({"call": call}), 200


@calls_bp.route("/calls/<uuid:call_id>", methods=["GET"])
@jwt_required()
def detail(call_id):
    try:
        call = get_call(str(call_id), get_jwt_identity(), _user_repository, _call_repository)
    except CallNotFoundError:
        return _not_found()
    return jsonify({"call": call}), 200


@calls_bp.route("/calls/<uuid:call_id>/accept", methods=["POST"])
@jwt_required()
def accept(call_id):
    try:
        result = accept_call(str(call_id), get_jwt_identity(), _user_repository, _call_repository)
    except CallsDisabledError:
        return _disabled()
    except CallNotFoundError:
        return _not_found()
    except CallStateError:
        return _bad_state()
    return jsonify(result), 200


def _simple_action(use_case, call_id):
    try:
        call = use_case(str(call_id), get_jwt_identity(), _user_repository, _call_repository)
    except CallNotFoundError:
        return _not_found()
    except CallStateError:
        return _bad_state()
    return jsonify({"call": call}), 200


@calls_bp.route("/calls/<uuid:call_id>/decline", methods=["POST"])
@jwt_required()
def decline(call_id):
    return _simple_action(decline_call, call_id)


@calls_bp.route("/calls/<uuid:call_id>/cancel", methods=["POST"])
@jwt_required()
def cancel(call_id):
    return _simple_action(cancel_call, call_id)


@calls_bp.route("/calls/<uuid:call_id>/end", methods=["POST"])
@jwt_required()
def end(call_id):
    return _simple_action(end_call, call_id)
