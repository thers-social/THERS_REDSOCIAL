# Rutas de reservas (ADR-040 fase 8). Todas exigen sesión.
#
# Personas:
#   POST   /api/places/<id>/reservations   solicitar (starts_at, party_size, note?)
#   GET    /api/reservations               mis reservas
#   DELETE /api/reservations/<id>          cancelar una reserva mía activa y futura
# Quien gestiona el lugar (`place_managers`; el resto recibe 404):
#   GET    /api/places/<id>/manage/reservations/settings     ver configuración
#   PUT    /api/places/<id>/manage/reservations/settings     activar y fijar cupo
#   GET    /api/places/<id>/manage/reservations?status=      solicitudes del lugar
#   POST   /api/places/<id>/manage/reservations/<rid>/confirm|decline   (note?)
#
# La identidad sale del JWT. Los campos no listados se ignoran.

from flask import Blueprint, Response, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.application.rate_limiting import rate_limit_guard
from app.application.reservations import reservation_use_cases as use_cases
from app.application.reservations import schedule_use_cases as schedule_cases
from app.domain.places.exceptions import PlaceNotFoundError
from app.domain.rate_limiting import policy
from app.domain.rate_limiting.exceptions import RateLimitExceededError
from app.domain.reservations.exceptions import (
    InvalidReservationDataError,
    PlaceClosedAtThatTimeError,
    ReservationConflictError,
    ReservationNotFoundError,
    ReservationResolvedError,
    ReservationsClosedError,
    SlotFullError,
)
from app.infrastructure.persistence.repositories.rate_limit_repository import (
    SQLAlchemyRateLimitRepository,
)
from app.infrastructure.persistence.repositories.reservation_repository import (
    SQLAlchemyReservationRepository,
)
from app.interfaces.rate_limited_response import rate_limited_response

reservations_bp = Blueprint("reservations", __name__)

_repository = SQLAlchemyReservationRepository()
_rate_limit_repository = SQLAlchemyRateLimitRepository()

_MANAGE = "/places/<uuid:place_id>/manage/reservations"


def _limited(user_id):
    try:
        rate_limit_guard.enforce(policy.RESERVATION_WRITE, f"user:{user_id}", _rate_limit_repository)
    except RateLimitExceededError as error:
        return rate_limited_response(error)
    return None


def _body():
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else None


def _failure(error):
    if isinstance(error, InvalidReservationDataError):
        return jsonify({"msg": error.message}), 400
    if isinstance(error, PlaceNotFoundError):
        return jsonify({"msg": "Lugar no encontrado"}), 404
    if isinstance(error, ReservationNotFoundError):
        return jsonify({"msg": "Reserva no encontrada"}), 404
    if isinstance(error, ReservationsClosedError):
        return jsonify({"msg": "Este lugar no acepta reservas"}), 409
    if isinstance(error, SlotFullError):
        return jsonify({"msg": "No queda cupo en ese horario"}), 409
    if isinstance(error, ReservationConflictError):
        return jsonify({"msg": "Ya tienes esa reserva o el máximo de reservas activas"}), 409
    if isinstance(error, ReservationResolvedError):
        return jsonify({"msg": "La reserva ya no admite ese cambio"}), 409
    if isinstance(error, PlaceClosedAtThatTimeError):
        msg = "El lugar está cerrado ese día" if error.reason == "closed_day" else "El lugar está cerrado a esa hora"
        return jsonify({"msg": msg, "reason": error.reason}), 409
    raise error


_DOMAIN_ERRORS = (
    InvalidReservationDataError,
    PlaceNotFoundError,
    ReservationNotFoundError,
    ReservationsClosedError,
    SlotFullError,
    ReservationConflictError,
    ReservationResolvedError,
    PlaceClosedAtThatTimeError,
)


@reservations_bp.route("/places/<uuid:place_id>/reservations", methods=["POST"])
@jwt_required()
def create(place_id):
    user_id = get_jwt_identity()
    data = _body()
    if data is None:
        return jsonify({"msg": "No se enviaron datos"}), 400
    limited = _limited(user_id)
    if limited is not None:
        return limited
    try:
        reservation = use_cases.create(user_id, place_id, data, _repository)
    except _DOMAIN_ERRORS as error:
        return _failure(error)
    return jsonify({"reservation": reservation}), 201


@reservations_bp.route("/reservations", methods=["GET"])
@jwt_required()
def list_own():
    return jsonify({"reservations": use_cases.list_own(get_jwt_identity(), _repository)}), 200


@reservations_bp.route("/reservations/<uuid:reservation_id>/pdf", methods=["GET"])
@jwt_required()
def reservation_pdf(reservation_id):
    try:
        pdf = use_cases.reservation_pdf(reservation_id, get_jwt_identity(), _repository)
    except _DOMAIN_ERRORS as error:
        return _failure(error)
    return Response(
        pdf,
        mimetype="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="reserva-{str(reservation_id)[:8]}.pdf"',
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


@reservations_bp.route("/reservations/<uuid:reservation_id>", methods=["DELETE"])
@jwt_required()
def cancel(reservation_id):
    try:
        reservation = use_cases.cancel(reservation_id, get_jwt_identity(), _repository)
    except _DOMAIN_ERRORS as error:
        return _failure(error)
    return jsonify({"reservation": reservation}), 200


@reservations_bp.route(f"{_MANAGE}/settings", methods=["GET"])
@jwt_required()
def get_settings(place_id):
    try:
        result = use_cases.settings(place_id, get_jwt_identity(), _repository)
    except _DOMAIN_ERRORS as error:
        return _failure(error)
    return jsonify({"settings": result}), 200


@reservations_bp.route(f"{_MANAGE}/settings", methods=["PUT"])
@jwt_required()
def put_settings(place_id):
    user_id = get_jwt_identity()
    data = _body()
    if data is None:
        return jsonify({"msg": "No se enviaron datos"}), 400
    limited = _limited(user_id)
    if limited is not None:
        return limited
    try:
        result = use_cases.update_settings(place_id, user_id, data, _repository)
    except _DOMAIN_ERRORS as error:
        return _failure(error)
    return jsonify({"settings": result}), 200


@reservations_bp.route(_MANAGE, methods=["GET"])
@jwt_required()
def list_for_place(place_id):
    try:
        reservations, has_more = use_cases.list_for_place(
            place_id, get_jwt_identity(), request.args.get("status"),
            request.args.get("limit"), request.args.get("offset"), _repository,
        )
    except _DOMAIN_ERRORS as error:
        return _failure(error)
    return jsonify({"reservations": reservations, "has_more": has_more}), 200


def _decide(place_id, reservation_id, confirm):
    user_id = get_jwt_identity()
    data = _body() or {}
    limited = _limited(user_id)
    if limited is not None:
        return limited
    try:
        result = use_cases.decide(place_id, reservation_id, user_id, confirm, data.get("note"), _repository)
    except _DOMAIN_ERRORS as error:
        return _failure(error)
    return jsonify({"reservation": result}), 200


@reservations_bp.route(f"{_MANAGE}/<uuid:reservation_id>/confirm", methods=["POST"])
@jwt_required()
def confirm(place_id, reservation_id):
    return _decide(place_id, reservation_id, True)


@reservations_bp.route(f"{_MANAGE}/<uuid:reservation_id>/decline", methods=["POST"])
@jwt_required()
def decline(place_id, reservation_id):
    return _decide(place_id, reservation_id, False)


# ------------------------------------------------------------------ horario y calendario (fase 9)


@reservations_bp.route("/places/<uuid:place_id>/hours", methods=["GET"])
@jwt_required()
def get_hours(place_id):
    try:
        result = schedule_cases.public_schedule(place_id, _repository)
    except _DOMAIN_ERRORS as error:
        return _failure(error)
    return jsonify({"schedule": result}), 200


@reservations_bp.route("/places/<uuid:place_id>/availability", methods=["GET"])
@jwt_required()
def get_availability(place_id):
    try:
        result = schedule_cases.availability(place_id, request.args.get("date"), _repository)
    except _DOMAIN_ERRORS as error:
        return _failure(error)
    return jsonify({"availability": result}), 200


@reservations_bp.route("/places/<uuid:place_id>/manage/hours", methods=["PUT"])
@jwt_required()
def put_hours(place_id):
    user_id = get_jwt_identity()
    data = _body()
    if data is None:
        return jsonify({"msg": "No se enviaron datos"}), 400
    limited = _limited(user_id)
    if limited is not None:
        return limited
    try:
        result = schedule_cases.set_week(place_id, user_id, data, _repository)
    except _DOMAIN_ERRORS as error:
        return _failure(error)
    return jsonify({"schedule": result}), 200


@reservations_bp.route("/places/<uuid:place_id>/manage/closures", methods=["POST"])
@jwt_required()
def post_closure(place_id):
    user_id = get_jwt_identity()
    data = _body()
    if data is None:
        return jsonify({"msg": "No se enviaron datos"}), 400
    limited = _limited(user_id)
    if limited is not None:
        return limited
    try:
        result = schedule_cases.add_closure(place_id, user_id, data, _repository)
    except _DOMAIN_ERRORS as error:
        return _failure(error)
    return jsonify({"closure": result}), 201


@reservations_bp.route("/places/<uuid:place_id>/manage/closures/<day>", methods=["DELETE"])
@jwt_required()
def delete_closure(place_id, day):
    try:
        result = schedule_cases.remove_closure(place_id, get_jwt_identity(), day, _repository)
    except _DOMAIN_ERRORS as error:
        return _failure(error)
    return jsonify(result), 200


@reservations_bp.route("/places/<uuid:place_id>/manage/calendar", methods=["GET"])
@jwt_required()
def get_calendar(place_id):
    try:
        result = schedule_cases.calendar(
            place_id, get_jwt_identity(), request.args.get("from"), request.args.get("to"), _repository
        )
    except _DOMAIN_ERRORS as error:
        return _failure(error)
    return jsonify(result), 200
