# Rutas del cotizador (ADR-040 fase 10). Todas exigen sesión.
#
#   GET    /api/places/<id>/quote-items                  catálogo activo (cualquier persona)
#   POST   /api/places/<id>/quotes                       pedir una cotización
#   GET    /api/quotes                                   mis cotizaciones
#   GET    /api/quotes/<id>                              detalle (quien la pidió o quien gestiona el lugar)
# Solo quien gestiona el lugar (`place_managers`; el resto recibe 404):
#   GET    /api/places/<id>/manage/quote-items           catálogo completo
#   POST   /api/places/<id>/manage/quote-items
#   PATCH  /api/places/<id>/manage/quote-items/<item_id>
#   DELETE /api/places/<id>/manage/quote-items/<item_id>
#   GET    /api/places/<id>/manage/quotes                cotizaciones pedidas a mi lugar
#   POST   /api/places/<id>/manage/quotes/<quote_id>/decision   aceptar o rechazar (fase 11)
# Fase 11 (quien la pidió o quien gestiona el lugar):
#   GET    /api/quotes/<id>/pdf                          PDF de la cotización
#
# El cliente NUNCA manda precios ni totales: solo `item_id` y `quantity`. Identidad del JWT.

from flask import Blueprint, Response, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.application.quotes import quote_use_cases as use_cases
from app.application.rate_limiting import rate_limit_guard
from app.domain.places.exceptions import PlaceNotFoundError
from app.domain.quotes.quotes import (
    InvalidQuoteDataError,
    QuoteAlreadyDecidedError,
    QuoteExpiredError,
    QuoteItemLimitError,
    QuoteItemNameTakenError,
    QuoteItemNotFoundError,
    QuoteNotFoundError,
)
from app.domain.rate_limiting import policy
from app.domain.rate_limiting.exceptions import RateLimitExceededError
from app.infrastructure.persistence.repositories.quote_repository import SQLAlchemyQuoteRepository
from app.infrastructure.persistence.repositories.rate_limit_repository import (
    SQLAlchemyRateLimitRepository,
)
from app.interfaces.rate_limited_response import rate_limited_response

quotes_bp = Blueprint("quotes", __name__)

_repository = SQLAlchemyQuoteRepository()
_rate_limit_repository = SQLAlchemyRateLimitRepository()

_MANAGE = "/places/<uuid:place_id>/manage"


def _limited(user_id):
    try:
        rate_limit_guard.enforce(policy.QUOTE_WRITE, f"user:{user_id}", _rate_limit_repository)
    except RateLimitExceededError as error:
        return rate_limited_response(error)
    return None


def _body():
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else None


def _failure(error):
    if isinstance(error, InvalidQuoteDataError):
        return jsonify({"msg": error.message}), 400
    if isinstance(error, PlaceNotFoundError):
        return jsonify({"msg": "Lugar no encontrado"}), 404
    if isinstance(error, QuoteNotFoundError):
        return jsonify({"msg": "Cotización no encontrada"}), 404
    if isinstance(error, QuoteItemNotFoundError):
        return jsonify({"msg": "Artículo no encontrado"}), 404
    if isinstance(error, QuoteAlreadyDecidedError):
        return jsonify({"msg": "Esta cotización ya fue decidida"}), 409
    if isinstance(error, QuoteExpiredError):
        return jsonify({"msg": "Esta cotización venció"}), 409
    if isinstance(error, QuoteItemLimitError):
        return jsonify({"msg": "El catálogo llegó al máximo de artículos activos"}), 409
    if isinstance(error, QuoteItemNameTakenError):
        return jsonify({"msg": "Ya hay un artículo con ese nombre"}), 409
    raise error


_DOMAIN_ERRORS = (
    InvalidQuoteDataError,
    PlaceNotFoundError,
    QuoteNotFoundError,
    QuoteItemNotFoundError,
    QuoteItemLimitError,
    QuoteItemNameTakenError,
    QuoteAlreadyDecidedError,
    QuoteExpiredError,
)


@quotes_bp.route("/places/<uuid:place_id>/quote-items", methods=["GET"])
@jwt_required()
def public_items(place_id):
    try:
        items = use_cases.public_items(place_id, _repository)
    except _DOMAIN_ERRORS as error:
        return _failure(error)
    return jsonify({"items": items}), 200


@quotes_bp.route("/places/<uuid:place_id>/quotes", methods=["POST"])
@jwt_required()
def create_quote(place_id):
    user_id = get_jwt_identity()
    data = _body()
    if data is None:
        return jsonify({"msg": "No se enviaron datos"}), 400
    limited = _limited(user_id)
    if limited is not None:
        return limited
    try:
        quote = use_cases.create_quote(place_id, user_id, data, _repository)
    except _DOMAIN_ERRORS as error:
        return _failure(error)
    return jsonify({"quote": quote}), 201


@quotes_bp.route("/quotes", methods=["GET"])
@jwt_required()
def list_own():
    return jsonify({"quotes": use_cases.list_own(get_jwt_identity(), _repository)}), 200


@quotes_bp.route("/quotes/<uuid:quote_id>", methods=["GET"])
@jwt_required()
def get_quote(quote_id):
    try:
        quote = use_cases.get_quote(quote_id, get_jwt_identity(), _repository)
    except _DOMAIN_ERRORS as error:
        return _failure(error)
    return jsonify({"quote": quote}), 200


@quotes_bp.route(f"{_MANAGE}/quote-items", methods=["GET"])
@jwt_required()
def manage_items(place_id):
    try:
        items = use_cases.manage_items(place_id, get_jwt_identity(), _repository)
    except _DOMAIN_ERRORS as error:
        return _failure(error)
    return jsonify({"items": items}), 200


@quotes_bp.route(f"{_MANAGE}/quote-items", methods=["POST"])
@jwt_required()
def create_item(place_id):
    user_id = get_jwt_identity()
    data = _body()
    if data is None:
        return jsonify({"msg": "No se enviaron datos"}), 400
    limited = _limited(user_id)
    if limited is not None:
        return limited
    try:
        item = use_cases.create_item(place_id, user_id, data, _repository)
    except _DOMAIN_ERRORS as error:
        return _failure(error)
    return jsonify({"item": item}), 201


@quotes_bp.route(f"{_MANAGE}/quote-items/<uuid:item_id>", methods=["PATCH"])
@jwt_required()
def update_item(place_id, item_id):
    user_id = get_jwt_identity()
    data = _body()
    if data is None:
        return jsonify({"msg": "No se enviaron datos"}), 400
    limited = _limited(user_id)
    if limited is not None:
        return limited
    try:
        item = use_cases.update_item(place_id, item_id, user_id, data, _repository)
    except _DOMAIN_ERRORS as error:
        return _failure(error)
    return jsonify({"item": item}), 200


@quotes_bp.route(f"{_MANAGE}/quote-items/<uuid:item_id>", methods=["DELETE"])
@jwt_required()
def delete_item(place_id, item_id):
    try:
        result = use_cases.delete_item(place_id, item_id, get_jwt_identity(), _repository)
    except _DOMAIN_ERRORS as error:
        return _failure(error)
    return jsonify(result), 200


@quotes_bp.route(f"{_MANAGE}/quotes", methods=["GET"])
@jwt_required()
def list_for_place(place_id):
    try:
        quotes, has_more = use_cases.list_for_place(
            place_id, get_jwt_identity(), request.args.get("limit"), request.args.get("offset"), _repository
        )
    except _DOMAIN_ERRORS as error:
        return _failure(error)
    return jsonify({"quotes": quotes, "has_more": has_more}), 200


@quotes_bp.route(f"{_MANAGE}/quotes/<uuid:quote_id>/decision", methods=["POST"])
@jwt_required()
def decide_quote(place_id, quote_id):
    user_id = get_jwt_identity()
    data = _body()
    if data is None:
        return jsonify({"msg": "No se enviaron datos"}), 400
    limited = _limited(user_id)
    if limited is not None:
        return limited
    try:
        quote = use_cases.decide_quote(place_id, quote_id, user_id, data, _repository)
    except _DOMAIN_ERRORS as error:
        return _failure(error)
    return jsonify({"quote": quote}), 200


@quotes_bp.route("/quotes/<uuid:quote_id>/pdf", methods=["GET"])
@jwt_required()
def quote_pdf(quote_id):
    try:
        pdf = use_cases.quote_pdf(quote_id, get_jwt_identity(), _repository)
    except _DOMAIN_ERRORS as error:
        return _failure(error)
    return Response(
        pdf,
        mimetype="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="cotizacion-{str(quote_id)[:8]}.pdf"',
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )
