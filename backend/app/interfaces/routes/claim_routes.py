# Rutas de los reclamos de negocio (ADR-040 fase 6).
#
# Personas con sesión:
#   POST   /api/places/<id>/claims   reclamar un lugar (multipart: business_name, message,
#                                    contact_phone y el archivo `document`)
#   GET    /api/users/me/claims      mis reclamos
#   DELETE /api/claims/<id>          retirar un reclamo pendiente
#
# Solo moderación (`is_moderator`; cualquier otra cuenta recibe el 404 de siempre):
#   GET  /api/moderation/place-claims?status=&limit=&offset=
#   GET  /api/moderation/place-claims/<id>
#   POST /api/moderation/place-claims/<id>/document-url   URL firmada de 5 min (queda auditada)
#   POST /api/moderation/place-claims/<id>/approve
#   POST /api/moderation/place-claims/<id>/reject          (note obligatoria)
#
# La identidad sale del JWT, nunca del cuerpo.

from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.application.claims import claim_use_cases
from app.application.rate_limiting import rate_limit_guard
from app.domain.claims import kinds
from app.domain.claims.exceptions import (
    ClaimAlreadyResolvedError,
    ClaimLimitError,
    ClaimNotFoundError,
    ClaimsUnavailableError,
    InvalidClaimDataError,
    PlaceAlreadyManagedError,
)
from app.domain.places.exceptions import PlaceNotFoundError
from app.domain.rate_limiting import policy
from app.domain.rate_limiting.exceptions import RateLimitExceededError
from app.infrastructure.media.image_processor import process_claim_document
from app.infrastructure.persistence.repositories.claim_repository import (
    SQLAlchemyClaimRepository,
)
from app.infrastructure.persistence.repositories.rate_limit_repository import (
    SQLAlchemyRateLimitRepository,
)
from app.interfaces.moderator_required import moderator_required
from app.interfaces.rate_limited_response import rate_limited_response

claims_bp = Blueprint("claims", __name__)

_repository = SQLAlchemyClaimRepository()
_rate_limit_repository = SQLAlchemyRateLimitRepository()

_MOD = "/moderation/place-claims"


def _storage():
    return current_app.extensions.get("private_storage")


def _limited(user_id):
    try:
        rate_limit_guard.enforce(policy.CLAIM_WRITE, f"user:{user_id}", _rate_limit_repository)
    except RateLimitExceededError as error:
        return rate_limited_response(error)
    return None


def _failure(error):
    if isinstance(error, InvalidClaimDataError):
        return jsonify({"msg": error.message}), 400
    if isinstance(error, PlaceNotFoundError):
        return jsonify({"msg": "Lugar no encontrado"}), 404
    if isinstance(error, ClaimNotFoundError):
        return jsonify({"msg": "Reclamo no encontrado"}), 404
    if isinstance(error, PlaceAlreadyManagedError):
        return jsonify({"msg": "Este lugar ya tiene una persona gestora"}), 409
    if isinstance(error, ClaimLimitError):
        return jsonify({"msg": "Ya tienes reclamos pendientes: espera la revisión"}), 409
    if isinstance(error, ClaimAlreadyResolvedError):
        return jsonify({"msg": "Este reclamo ya fue resuelto"}), 409
    if isinstance(error, ClaimsUnavailableError):
        return jsonify({"msg": "Los reclamos no están disponibles por ahora"}), 503
    raise error


_DOMAIN_ERRORS = (
    InvalidClaimDataError,
    PlaceNotFoundError,
    ClaimNotFoundError,
    PlaceAlreadyManagedError,
    ClaimLimitError,
    ClaimAlreadyResolvedError,
    ClaimsUnavailableError,
)


def _form():
    """Campos del reclamo: multipart (con archivo) o JSON (que no trae archivo)."""
    if request.files or request.form:
        return request.form
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


@claims_bp.route("/places/<uuid:place_id>/claims", methods=["POST"])
@jwt_required()
def create_claim(place_id):
    user_id = get_jwt_identity()
    limited = _limited(user_id)
    if limited is not None:
        return limited
    upload = request.files.get("document")
    raw = upload.read(kinds.MAX_DOCUMENT_BYTES + 1) if upload else None
    try:
        claim = claim_use_cases.create_claim(
            user_id, place_id, _form(), raw, _repository, _storage(), process_claim_document
        )
    except _DOMAIN_ERRORS as error:
        return _failure(error)
    return jsonify({"claim": claim}), 201


@claims_bp.route("/users/me/claims", methods=["GET"])
@jwt_required()
def list_own_claims():
    return jsonify({"claims": claim_use_cases.list_own_claims(get_jwt_identity(), _repository)}), 200


@claims_bp.route("/claims/<uuid:claim_id>", methods=["DELETE"])
@jwt_required()
def withdraw_claim(claim_id):
    try:
        claim = claim_use_cases.withdraw_claim(
            claim_id, get_jwt_identity(), _repository, _storage()
        )
    except _DOMAIN_ERRORS as error:
        return _failure(error)
    return jsonify({"claim": claim}), 200


# ------------------------------------------------------------------ moderación


@claims_bp.route(_MOD, methods=["GET"])
@moderator_required
def review_list():
    try:
        claims, has_more = claim_use_cases.review_list(
            request.args.get("status"),
            request.args.get("limit"),
            request.args.get("offset"),
            _repository,
        )
    except _DOMAIN_ERRORS as error:
        return _failure(error)
    return jsonify({"claims": claims, "has_more": has_more}), 200


@claims_bp.route(f"{_MOD}/<uuid:claim_id>", methods=["GET"])
@moderator_required
def review_get(claim_id):
    try:
        claim = claim_use_cases.review_get(claim_id, _repository)
    except _DOMAIN_ERRORS as error:
        return _failure(error)
    return jsonify({"claim": claim}), 200


@claims_bp.route(f"{_MOD}/<uuid:claim_id>/document-url", methods=["POST"])
@moderator_required
def document_url(claim_id):
    try:
        document = claim_use_cases.document_url(
            claim_id, get_jwt_identity(), _repository, _storage()
        )
    except _DOMAIN_ERRORS as error:
        return _failure(error)
    response = jsonify({"document": document})
    response.headers["Cache-Control"] = "no-store"
    return response, 200


def _decide(claim_id, approve):
    data = request.get_json(silent=True)
    data = data if isinstance(data, dict) else {}
    try:
        claim = claim_use_cases.decide(
            claim_id, get_jwt_identity(), approve, data.get("note"), _repository, _storage()
        )
    except _DOMAIN_ERRORS as error:
        return _failure(error)
    return jsonify({"claim": claim}), 200


@claims_bp.route(f"{_MOD}/<uuid:claim_id>/approve", methods=["POST"])
@moderator_required
def approve(claim_id):
    return _decide(claim_id, True)


@claims_bp.route(f"{_MOD}/<uuid:claim_id>/reject", methods=["POST"])
@moderator_required
def reject(claim_id):
    return _decide(claim_id, False)
