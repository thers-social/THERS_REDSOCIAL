# Moderación de THERS Places (ADR-040-thers-places.md, fase 2; decisión D3: se reutiliza
# `is_moderator`). Todas las rutas van bajo `/api/moderation/places` y con
# `@moderator_required`: quien NO es moderador recibe el mismo 404 que una URL que no
# existe (ADR-032 §3), no un 403 que anunciaría que la ruta está ahí.
#
# La identidad de quien actúa sale SOLO del JWT. Cada cambio queda en `admin_audit_log`,
# en la misma transacción que el cambio.
#
# Un cuerpo que no sea un objeto JSON da 400. Los campos desconocidos se ignoran (lista
# blanca en `domain/places/write_validators.py`).

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity

from app.application.places import place_use_cases
from app.domain.places.exceptions import (
    InvalidPlaceDataError,
    InvalidPlaceQueryError,
    PlaceNotFoundError,
    PlaceReportAlreadyResolvedError,
    PlaceReportNotFoundError,
)
from app.infrastructure.persistence.repositories.place_repository import (
    SQLAlchemyPlaceRepository,
)
from app.interfaces.moderator_required import moderator_required

place_moderation_bp = Blueprint("place_moderation", __name__)

_place_repository = SQLAlchemyPlaceRepository()

_BASE = "/moderation/places"


def _body():
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else None


def _bad(error):
    return jsonify({"msg": error.message}), 400


def _not_found():
    return jsonify({"msg": "Lugar no encontrado"}), 404


@place_moderation_bp.route(f"{_BASE}/summary", methods=["GET"])
@moderator_required
def get_summary():
    return jsonify({"summary": place_use_cases.moderation_summary(_place_repository)}), 200


@place_moderation_bp.route(f"{_BASE}/reports", methods=["GET"])
@moderator_required
def get_reports():
    try:
        reports, has_more = place_use_cases.moderation_list_reports(
            request.args.get("status"),
            request.args.get("limit"),
            request.args.get("offset"),
            _place_repository,
        )
    except InvalidPlaceQueryError as error:
        return _bad(error)
    return jsonify({"reports": reports, "has_more": has_more}), 200


@place_moderation_bp.route(f"{_BASE}/reports/<uuid:report_id>/resolve", methods=["POST"])
@moderator_required
def post_resolve_report(report_id):
    data = _body()
    if data is None:
        return jsonify({"msg": "No se enviaron datos"}), 400
    try:
        report = place_use_cases.moderation_resolve_report(
            get_jwt_identity(), report_id, data.get("status"), data.get("note"), _place_repository
        )
    except InvalidPlaceDataError as error:
        return _bad(error)
    except PlaceReportNotFoundError:
        return jsonify({"msg": "Reporte no encontrado"}), 404
    except PlaceReportAlreadyResolvedError:
        return jsonify({"msg": "Este reporte ya fue resuelto"}), 409
    return jsonify({"report": report}), 200


@place_moderation_bp.route(_BASE, methods=["GET"])
@moderator_required
def list_places():
    try:
        places, has_more = place_use_cases.moderation_list_places(
            request.args.get("status"),
            request.args.get("q"),
            request.args.get("limit"),
            request.args.get("offset"),
            _place_repository,
        )
    except InvalidPlaceQueryError as error:
        return _bad(error)
    return jsonify({"places": places, "has_more": has_more}), 200


@place_moderation_bp.route(_BASE, methods=["POST"])
@moderator_required
def create_place():
    data = _body()
    if data is None:
        return jsonify({"msg": "No se enviaron datos"}), 400
    try:
        place = place_use_cases.moderation_create_place(
            get_jwt_identity(), data, _place_repository
        )
    except InvalidPlaceDataError as error:
        return _bad(error)
    return jsonify({"place": place}), 201


@place_moderation_bp.route(f"{_BASE}/<uuid:place_id>", methods=["GET"])
@moderator_required
def get_place(place_id):
    try:
        place = place_use_cases.moderation_get_place(place_id, _place_repository)
    except PlaceNotFoundError:
        return _not_found()
    return jsonify({"place": place}), 200


@place_moderation_bp.route(f"{_BASE}/<uuid:place_id>", methods=["PATCH"])
@moderator_required
def patch_place(place_id):
    data = _body()
    if data is None:
        return jsonify({"msg": "No se enviaron datos"}), 400
    try:
        place = place_use_cases.moderation_update_place(
            get_jwt_identity(), place_id, data, _place_repository
        )
    except InvalidPlaceDataError as error:
        return _bad(error)
    except PlaceNotFoundError:
        return _not_found()
    return jsonify({"place": place}), 200


@place_moderation_bp.route(f"{_BASE}/<uuid:place_id>/status", methods=["PATCH"])
@moderator_required
def patch_status(place_id):
    data = _body()
    if data is None:
        return jsonify({"msg": "No se enviaron datos"}), 400
    try:
        place = place_use_cases.moderation_set_status(
            get_jwt_identity(), place_id, data, _place_repository
        )
    except InvalidPlaceDataError as error:
        return _bad(error)
    except PlaceNotFoundError:
        return _not_found()
    return jsonify({"place": place}), 200
