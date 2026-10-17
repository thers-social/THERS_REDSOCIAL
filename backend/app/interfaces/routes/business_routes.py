# Rutas del panel de negocio (ADR-040 fase 7). Todas exigen sesión Y ser gestor del lugar
# (`place_managers`, fase 6); quien no lo es recibe el mismo 404 que si el lugar no existiera.
#
#   GET    /api/users/me/managed-places                      mis lugares gestionados
#   GET    /api/places/<id>/manage                           datos editables y cifras
#   GET    /api/places/<id>/manage/analytics?days=7|30|90    estadísticas (ADR-040 §31)
#   PATCH  /api/places/<id>/manage                           editar descripción, dirección,
#                                                            teléfono y sitio web
#   PUT    /api/places/<id>/reviews/<review_id>/reply        responder (o corregir la respuesta)
#   DELETE /api/places/<id>/reviews/<review_id>/reply        quitar la respuesta
#
# La identidad sale del JWT. Un cuerpo que no sea un objeto JSON da 400; los campos no
# permitidos se ignoran (lista blanca en `business_use_cases.MANAGER_EDITABLE`).

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.application.business import business_use_cases
from app.application.rate_limiting import rate_limit_guard
from app.domain.places.exceptions import (
    InvalidPlaceDataError,
    InvalidPlaceQueryError,
    PlaceNotFoundError,
    PlaceReviewNotFoundError,
)
from app.domain.rate_limiting import policy
from app.domain.rate_limiting.exceptions import RateLimitExceededError
from app.infrastructure.persistence.repositories.business_repository import (
    SQLAlchemyBusinessRepository,
)
from app.infrastructure.persistence.repositories.place_repository import (
    SQLAlchemyPlaceRepository,
)
from app.infrastructure.persistence.repositories.rate_limit_repository import (
    SQLAlchemyRateLimitRepository,
)
from app.interfaces.rate_limited_response import rate_limited_response

business_bp = Blueprint("business", __name__)

_repository = SQLAlchemyBusinessRepository()
_place_repository = SQLAlchemyPlaceRepository()
_rate_limit_repository = SQLAlchemyRateLimitRepository()


def _limited(user_id):
    try:
        rate_limit_guard.enforce(policy.BUSINESS_WRITE, f"user:{user_id}", _rate_limit_repository)
    except RateLimitExceededError as error:
        return rate_limited_response(error)
    return None


def _body():
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else None


def _failure(error):
    if isinstance(error, InvalidPlaceDataError):
        return jsonify({"msg": error.message}), 400
    if isinstance(error, PlaceNotFoundError):
        return jsonify({"msg": "Lugar no encontrado"}), 404
    if isinstance(error, PlaceReviewNotFoundError):
        return jsonify({"msg": "Reseña no encontrada"}), 404
    raise error


_DOMAIN_ERRORS = (InvalidPlaceDataError, PlaceNotFoundError, PlaceReviewNotFoundError)


@business_bp.route("/users/me/managed-places", methods=["GET"])
@jwt_required()
def managed_places():
    places = business_use_cases.list_managed(get_jwt_identity(), _repository)
    return jsonify({"places": places}), 200


@business_bp.route("/places/<uuid:place_id>/manage", methods=["GET"])
@jwt_required()
def panel(place_id):
    try:
        result = business_use_cases.get_panel(
            place_id, get_jwt_identity(), _repository, _place_repository
        )
    except _DOMAIN_ERRORS as error:
        return _failure(error)
    return jsonify(result), 200


@business_bp.route("/places/<uuid:place_id>/manage/analytics", methods=["GET"])
@jwt_required()
def analytics(place_id):
    user_id = get_jwt_identity()
    try:
        rate_limit_guard.enforce(policy.BUSINESS_ANALYTICS, f"user:{user_id}", _rate_limit_repository)
    except RateLimitExceededError as error:
        return rate_limited_response(error)
    try:
        report = business_use_cases.get_analytics(
            place_id, user_id, request.args.get("days"), _repository, _place_repository
        )
    except InvalidPlaceQueryError as error:
        return jsonify({"msg": error.message}), 400
    except _DOMAIN_ERRORS as error:
        return _failure(error)
    response = jsonify({"analytics": report})
    response.headers["Cache-Control"] = "no-store"
    return response, 200


@business_bp.route("/places/<uuid:place_id>/manage", methods=["PATCH"])
@jwt_required()
def update_place(place_id):
    user_id = get_jwt_identity()
    data = _body()
    if data is None:
        return jsonify({"msg": "No se enviaron datos"}), 400
    limited = _limited(user_id)
    if limited is not None:
        return limited
    try:
        place = business_use_cases.update_place(
            place_id, user_id, data, _repository, _place_repository
        )
    except _DOMAIN_ERRORS as error:
        return _failure(error)
    return jsonify({"place": place}), 200


@business_bp.route("/places/<uuid:place_id>/reviews/<uuid:review_id>/reply", methods=["PUT"])
@jwt_required()
def put_reply(place_id, review_id):
    user_id = get_jwt_identity()
    data = _body()
    if data is None:
        return jsonify({"msg": "No se enviaron datos"}), 400
    limited = _limited(user_id)
    if limited is not None:
        return limited
    try:
        reply = business_use_cases.reply(
            place_id, review_id, user_id, data.get("body"), _repository, _place_repository
        )
    except _DOMAIN_ERRORS as error:
        return _failure(error)
    return jsonify({"reply": reply}), 200


@business_bp.route("/places/<uuid:place_id>/reviews/<uuid:review_id>/reply", methods=["DELETE"])
@jwt_required()
def delete_reply(place_id, review_id):
    try:
        result = business_use_cases.delete_reply(
            place_id, review_id, get_jwt_identity(), _repository, _place_repository
        )
    except _DOMAIN_ERRORS as error:
        return _failure(error)
    return jsonify(result), 200
