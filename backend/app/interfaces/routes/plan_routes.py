# Rutas de los planes con amistades (ADR-040 fase 5). Todas exigen sesión.
#
#   GET    /api/users/me/friends            mis amistades (a quiénes puedo invitar)
#   POST   /api/places/<id>/plans           crear un plan en un lugar público
#   GET    /api/plans?scope=upcoming|past   mis planes (creados o con invitación)
#   GET    /api/plans/<id>                  detalle (404 si no eres integrante)
#   PATCH  /api/plans/<id>                  editar (solo quien lo creó)
#   DELETE /api/plans/<id>                  cancelar (solo quien lo creó)
#   POST   /api/plans/<id>/invites          invitar amistades (solo quien lo creó)
#   PUT    /api/plans/<id>/response         ir / no ir
#   DELETE /api/plans/<id>/members/<uid>    sacar a alguien, o salirte tú
#
# La identidad sale del JWT, nunca del cuerpo. `<uuid:...>` responde 404 a cualquier segmento
# que no sea un UUID.

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.application.plans import plan_use_cases
from app.application.rate_limiting import rate_limit_guard
from app.domain.places.exceptions import PlaceNotFoundError
from app.domain.plans.exceptions import (
    InvalidPlanDataError,
    NotFriendsError,
    PlanClosedError,
    PlanForbiddenError,
    PlanFullError,
    PlanNotFoundError,
)
from app.domain.rate_limiting import policy
from app.domain.rate_limiting.exceptions import RateLimitExceededError
from app.infrastructure.persistence.repositories.plan_repository import (
    SQLAlchemyPlanRepository,
)
from app.infrastructure.persistence.repositories.rate_limit_repository import (
    SQLAlchemyRateLimitRepository,
)
from app.interfaces.rate_limited_response import rate_limited_response

plans_bp = Blueprint("plans", __name__)

_repository = SQLAlchemyPlanRepository()
_rate_limit_repository = SQLAlchemyRateLimitRepository()


def _limited(user_id):
    try:
        rate_limit_guard.enforce(policy.PLAN_WRITE, f"user:{user_id}", _rate_limit_repository)
    except RateLimitExceededError as error:
        return rate_limited_response(error)
    return None


def _body():
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else None


def _failure(error):
    """Respuesta para las excepciones de dominio comunes a todas las rutas."""
    if isinstance(error, InvalidPlanDataError):
        return jsonify({"msg": error.message}), 400
    if isinstance(error, NotFriendsError):
        return jsonify({"msg": "Solo puedes invitar a personas que te siguen y sigues"}), 400
    if isinstance(error, PlaceNotFoundError):
        return jsonify({"msg": "Lugar no encontrado"}), 404
    if isinstance(error, PlanNotFoundError):
        return jsonify({"msg": "Plan no encontrado"}), 404
    if isinstance(error, PlanForbiddenError):
        return jsonify({"msg": "No puedes hacer esto en este plan"}), 403
    if isinstance(error, PlanClosedError):
        return jsonify({"msg": "El plan está cancelado o ya pasó"}), 409
    if isinstance(error, PlanFullError):
        return jsonify({"msg": "El plan llegó al máximo de integrantes"}), 409
    raise error


_DOMAIN_ERRORS = (
    InvalidPlanDataError,
    NotFriendsError,
    PlaceNotFoundError,
    PlanNotFoundError,
    PlanForbiddenError,
    PlanClosedError,
    PlanFullError,
)


@plans_bp.route("/places/<uuid:place_id>/plans", methods=["POST"])
@jwt_required()
def create_plan(place_id):
    user_id = get_jwt_identity()
    data = _body()
    if data is None:
        return jsonify({"msg": "No se enviaron datos"}), 400
    limited = _limited(user_id)
    if limited is not None:
        return limited
    # Lista blanca: solo title, note, starts_at y user_ids; el resto se ignora.
    try:
        plan = plan_use_cases.create_plan(user_id, place_id, data, _repository)
    except _DOMAIN_ERRORS as error:
        return _failure(error)
    return jsonify({"plan": plan}), 201


@plans_bp.route("/users/me/friends", methods=["GET"])
@jwt_required()
def list_friends():
    """Amistades (seguimiento mutuo sin bloqueo): a quiénes se puede invitar a un plan."""
    friends = plan_use_cases.list_friends(get_jwt_identity(), _repository)
    return jsonify({"friends": friends}), 200


@plans_bp.route("/plans", methods=["GET"])
@jwt_required()
def list_plans():
    user_id = get_jwt_identity()
    try:
        plans = plan_use_cases.list_plans(user_id, request.args.get("scope"), _repository)
    except _DOMAIN_ERRORS as error:
        return _failure(error)
    return jsonify({"plans": plans}), 200


@plans_bp.route("/plans/<uuid:plan_id>", methods=["GET"])
@jwt_required()
def get_plan(plan_id):
    try:
        plan = plan_use_cases.get_plan(plan_id, get_jwt_identity(), _repository)
    except _DOMAIN_ERRORS as error:
        return _failure(error)
    return jsonify({"plan": plan}), 200


@plans_bp.route("/plans/<uuid:plan_id>", methods=["PATCH"])
@jwt_required()
def update_plan(plan_id):
    user_id = get_jwt_identity()
    data = _body()
    if data is None:
        return jsonify({"msg": "No se enviaron datos"}), 400
    limited = _limited(user_id)
    if limited is not None:
        return limited
    try:
        plan = plan_use_cases.update_plan(plan_id, user_id, data, _repository)
    except _DOMAIN_ERRORS as error:
        return _failure(error)
    return jsonify({"plan": plan}), 200


@plans_bp.route("/plans/<uuid:plan_id>", methods=["DELETE"])
@jwt_required()
def cancel_plan(plan_id):
    user_id = get_jwt_identity()
    limited = _limited(user_id)
    if limited is not None:
        return limited
    try:
        plan = plan_use_cases.cancel_plan(plan_id, user_id, _repository)
    except _DOMAIN_ERRORS as error:
        return _failure(error)
    return jsonify({"plan": plan}), 200


@plans_bp.route("/plans/<uuid:plan_id>/invites", methods=["POST"])
@jwt_required()
def invite(plan_id):
    user_id = get_jwt_identity()
    data = _body()
    if data is None:
        return jsonify({"msg": "No se enviaron datos"}), 400
    limited = _limited(user_id)
    if limited is not None:
        return limited
    try:
        plan = plan_use_cases.invite(plan_id, user_id, data, _repository)
    except _DOMAIN_ERRORS as error:
        return _failure(error)
    return jsonify({"plan": plan}), 200


@plans_bp.route("/plans/<uuid:plan_id>/response", methods=["PUT"])
@jwt_required()
def respond(plan_id):
    user_id = get_jwt_identity()
    data = _body()
    if data is None:
        return jsonify({"msg": "No se enviaron datos"}), 400
    limited = _limited(user_id)
    if limited is not None:
        return limited
    try:
        plan = plan_use_cases.respond(plan_id, user_id, data, _repository)
    except _DOMAIN_ERRORS as error:
        return _failure(error)
    return jsonify({"plan": plan}), 200


@plans_bp.route("/plans/<uuid:plan_id>/members/<uuid:member_id>", methods=["DELETE"])
@jwt_required()
def remove_member(plan_id, member_id):
    user_id = get_jwt_identity()
    limited = _limited(user_id)
    if limited is not None:
        return limited
    try:
        result = plan_use_cases.remove_member(plan_id, user_id, member_id, _repository)
    except _DOMAIN_ERRORS as error:
        return _failure(error)
    return jsonify(result), 200
