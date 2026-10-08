# Rutas de THERS Places (ADR-040-thers-places.md):
#
#   Públicas (sin JWT; con sesión añaden `is_saved`):
#     GET /api/places/categories, /api/places, /api/places/nearby, /api/places/search,
#     /api/places/<id>
#   Con sesión:
#     GET /api/places/saved, POST|DELETE /api/places/<id>/save, POST /api/places/<id>/report
#
# Como las públicas no tienen identidad de usuario, su límite de uso es por IP (ADR-027).
# Esa IP viene de `X-Forwarded-For`, que el cliente puede falsificar; para un catálogo de
# solo lectura eso es aceptable (ADR-027 §Riesgos). Guardar y reportar se limitan además
# por cuenta, que no se puede falsear.
#
# PRIVACIDAD: `lat`/`lng` de `/places/nearby` y `/places/search` viajan en la query string.
# Estas rutas no los registran ni los guardan, pero los registros de acceso del proxy y las
# herramientas de errores pueden capturar la URL completa (ADR-040 §4.4, R5).
#
# `<uuid:place_id>`: el conversor `uuid` de Flask devuelve 404 para cualquier segmento que
# no sea un UUID válido (mismo criterio que like_routes.py).

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.application.places import place_use_cases
from app.application.rate_limiting import rate_limit_guard
from app.domain.places.exceptions import (
    InvalidPlaceDataError,
    InvalidPlaceQueryError,
    PlaceNotFoundError,
)
from app.domain.rate_limiting import policy
from app.domain.rate_limiting.exceptions import RateLimitExceededError
from app.infrastructure.persistence.repositories.place_repository import (
    SQLAlchemyPlaceRepository,
)
from app.infrastructure.persistence.repositories.rate_limit_repository import (
    SQLAlchemyRateLimitRepository,
)
from app.interfaces.optional_user import optional_user_id
from app.interfaces.rate_limited_response import rate_limited_response

places_bp = Blueprint("places", __name__)

_place_repository = SQLAlchemyPlaceRepository()
_rate_limit_repository = SQLAlchemyRateLimitRepository()

_NOT_FOUND = ({"msg": "Lugar no encontrado"}, 404)


def _client_ip():
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.remote_addr or "unknown"


def _enforce(rule, identity):
    """`None` si pasa, o la respuesta 429 lista para devolver."""
    try:
        rate_limit_guard.enforce(rule, identity, _rate_limit_repository)
    except RateLimitExceededError as error:
        return rate_limited_response(error)
    return None


@places_bp.before_request
def _limit_reads():
    return _enforce(policy.PLACES_READ, f"ip:{_client_ip()}")


# ------------------------------------------------------------------- públicas


@places_bp.route("/places/categories", methods=["GET"])
def categories():
    return jsonify({"categories": place_use_cases.list_categories(_place_repository)}), 200


@places_bp.route("/places", methods=["GET"])
def list_all():
    try:
        places = place_use_cases.list_places(
            request.args.get("category"),
            request.args.get("limit"),
            request.args.get("offset"),
            _place_repository,
            optional_user_id(),
        )
    except InvalidPlaceQueryError as error:
        return jsonify({"msg": error.message}), 400
    return jsonify({"places": places}), 200


@places_bp.route("/places/nearby", methods=["GET"])
def nearby():
    try:
        places = place_use_cases.nearby_places(
            request.args.get("lat"),
            request.args.get("lng"),
            request.args.get("radius"),
            request.args.get("category"),
            request.args.get("limit"),
            _place_repository,
            optional_user_id(),
        )
    except InvalidPlaceQueryError as error:
        return jsonify({"msg": error.message}), 400
    return jsonify({"places": places}), 200


@places_bp.route("/places/search", methods=["GET"])
def search():
    try:
        places = place_use_cases.search_places(
            request.args.get("q"),
            request.args.get("lat"),
            request.args.get("lng"),
            request.args.get("category"),
            request.args.get("limit"),
            _place_repository,
            optional_user_id(),
        )
    except InvalidPlaceQueryError as error:
        return jsonify({"msg": error.message}), 400
    return jsonify({"places": places}), 200


@places_bp.route("/places/<uuid:place_id>", methods=["GET"])
def detail(place_id):
    try:
        place = place_use_cases.get_place(place_id, _place_repository, optional_user_id())
    except PlaceNotFoundError:
        # Mismo 404 si no existe, está inactivo o no es público.
        return jsonify(_NOT_FOUND[0]), 404
    return jsonify({"place": place}), 200


# ----------------------------------------------------------------- con sesión


@places_bp.route("/places/saved", methods=["GET"])
@jwt_required()
def saved():
    # Identidad exclusivamente del JWT: cada quien ve solo sus guardados.
    try:
        places = place_use_cases.list_saved(
            get_jwt_identity(),
            request.args.get("limit"),
            request.args.get("offset"),
            _place_repository,
        )
    except InvalidPlaceQueryError as error:
        return jsonify({"msg": error.message}), 400
    return jsonify({"places": places}), 200


@places_bp.route("/places/<uuid:place_id>/save", methods=["POST"])
@jwt_required()
def save(place_id):
    user_id = get_jwt_identity()
    limited = _enforce(policy.PLACES_SAVE, f"user:{user_id}")
    if limited is not None:
        return limited
    try:
        result = place_use_cases.save_place(user_id, place_id, _place_repository)
    except PlaceNotFoundError:
        return jsonify(_NOT_FOUND[0]), 404
    return jsonify(result), 200


@places_bp.route("/places/<uuid:place_id>/save", methods=["DELETE"])
@jwt_required()
def unsave(place_id):
    user_id = get_jwt_identity()
    limited = _enforce(policy.PLACES_SAVE, f"user:{user_id}")
    if limited is not None:
        return limited
    try:
        result = place_use_cases.unsave_place(user_id, place_id, _place_repository)
    except PlaceNotFoundError:
        return jsonify(_NOT_FOUND[0]), 404
    return jsonify(result), 200


@places_bp.route("/places/<uuid:place_id>/report", methods=["POST"])
@jwt_required()
def report(place_id):
    user_id = get_jwt_identity()
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"msg": "No se enviaron datos"}), 400

    # El límite va ANTES de cualquier trabajo y es por cuenta (no por IP).
    limited = _enforce(policy.PLACE_REPORT, f"user:{user_id}")
    if limited is not None:
        return limited

    # Whitelist explícita: `reporter_id`, `status` y cualquier otro campo del cuerpo se
    # ignoran; la identidad sale SOLO del JWT.
    try:
        created_report, created = place_use_cases.report_place(
            user_id, place_id, data.get("reason"), data.get("details"), _place_repository
        )
    except InvalidPlaceDataError as error:
        return jsonify({"msg": error.message}), 400
    except PlaceNotFoundError:
        return jsonify(_NOT_FOUND[0]), 404
    # 201 la primera vez; 200 si ya tenías un reporte abierto igual (idempotente).
    return jsonify({"report": created_report}), 201 if created else 200
