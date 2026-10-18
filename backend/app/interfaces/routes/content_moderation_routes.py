# Panel de moderación de contenido y apelaciones (ADR-044 §2.6–§2.7). Amplía lo que ya existe en
# `moderation_routes.py` (reportes); no es un segundo panel.
#
# Toda autorización se decide aquí, contra la base, en cada petición (`moderation_role_required`).
# Con `MODERATION_ENABLED` apagado ninguna de estas rutas existe (404).

import uuid
from datetime import datetime, timezone

from flask import Blueprint, current_app, g, jsonify, request, send_from_directory
from flask_jwt_extended import get_jwt_identity

from app.application.content_moderation import panel_use_cases as uc
from app.application.rate_limiting import rate_limit_guard
from app.domain.content_moderation import roles, subjects
from app.domain.rate_limiting import policy
from app.domain.rate_limiting.exceptions import RateLimitExceededError
from app.infrastructure.persistence.repositories.content_moderation_repository import (
    SQLAlchemyContentModerationRepository,
)
from app.infrastructure.persistence.repositories.domain_event_repository import (
    SQLAlchemyDomainEventRepository,
)
from app.infrastructure.persistence.repositories.moderation_queue_repository import (
    SQLAlchemyModerationQueueRepository,
)
from app.infrastructure.persistence.repositories.rate_limit_repository import (
    SQLAlchemyRateLimitRepository,
)
from app.infrastructure.persistence.repositories.user_repository import SQLAlchemyUserRepository
from app.interfaces.moderation_role_required import feature_required, moderation_role_required
from app.interfaces.rate_limited_response import rate_limited_response

content_moderation_bp = Blueprint("content_moderation", __name__)

_queue = SQLAlchemyModerationQueueRepository()
_repository = SQLAlchemyContentModerationRepository()
_users = SQLAlchemyUserRepository()
_events = SQLAlchemyDomainEventRepository()
_rate_limit_repository = SQLAlchemyRateLimitRepository()

#: Vida de la URL firmada con la que moderación ve un archivo privado.
PREVIEW_URL_TTL_SECONDS = 300


def _now():
    return datetime.now(timezone.utc)


def _subject():
    """Tipo de contenido de `?type=media|story`, o `None` si no es uno conocido."""
    return subjects.parse(request.args.get("type"))


def _bad_type():
    return jsonify({"msg": "type debe ser media o story"}), 400


def _error(error):
    if isinstance(error, uc.NotFoundError):
        return jsonify({"msg": "Recurso no encontrado"}), 404
    if isinstance(error, uc.InvalidRequestError):
        return jsonify({"msg": error.message}), 400
    if isinstance(error, uc.ConflictError):
        return jsonify({"msg": error.message}), 409
    if isinstance(error, uc.ForbiddenError):
        return jsonify({"msg": error.message}), 403
    if isinstance(error, uc.TooManyAppealsError):
        return jsonify({"msg": "Tienes demasiadas apelaciones abiertas"}), 429
    raise error


# --- Panel (cualquier rol de moderación) -----------------------------------------------------


@content_moderation_bp.route("/moderation/media", methods=["GET"])
@moderation_role_required()
def queue():
    subject = _subject()
    if subject is None:
        return _bad_type()
    try:
        return jsonify(uc.list_queue(
            request.args.get("status"), request.args.get("limit"), request.args.get("offset"),
            g.moderation_role, _queue, subject,
        )), 200
    except (uc.InvalidRequestError, uc.NotFoundError) as error:
        return _error(error)


@content_moderation_bp.route("/moderation/media/<uuid:attachment_id>", methods=["GET"])
@moderation_role_required()
def detail(attachment_id):
    subject = _subject()
    if subject is None:
        return _bad_type()
    try:
        return jsonify(uc.get_detail(attachment_id, g.moderation_role, _queue, subject)), 200
    except uc.NotFoundError as error:
        return _error(error)


@content_moderation_bp.route("/moderation/media/<uuid:attachment_id>/file", methods=["GET"])
@moderation_role_required()
def preview(attachment_id):
    """Archivo de una imagen retenida, SOLO para moderación. Con almacenamiento remoto no hay
    vista previa todavía (exige bucket privado y URLs firmadas: ADR-044, almacenamiento privado)."""
    subject = _subject()
    if subject is None:
        return _bad_type()
    item = _queue.get_item(attachment_id, subject)
    if item is None or (item["restricted"] and not roles.can_see_restricted(g.moderation_role)):
        return jsonify({"msg": "Recurso no encontrado"}), 404
    key, private = _queue.storage_ref(attachment_id, subject)
    if private:
        # Archivo del almacenamiento PRIVADO: no hay bytes que servir desde aquí; se entrega una
        # URL firmada de vida corta (ver `/moderation/media/<id>/preview-url`).
        return jsonify({"msg": "Usa preview-url para este archivo"}), 409
    if current_app.config.get("STORAGE_BACKEND") != "local":
        return jsonify({"msg": "Vista previa no disponible con almacenamiento remoto"}), 501
    response = send_from_directory(current_app.config["UPLOAD_DIR"], key)
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@content_moderation_bp.route("/moderation/media/<uuid:attachment_id>/preview-url", methods=["GET"])
@moderation_role_required()
def preview_url(attachment_id):
    """URL firmada y de vida corta de un archivo del almacenamiento privado (historias), solo para
    moderación. Se emite tras comprobar el rol y la restricción, como el resto de rutas."""
    subject = _subject()
    if subject is None:
        return _bad_type()
    item = _queue.get_item(attachment_id, subject)
    if item is None or (item["restricted"] and not roles.can_see_restricted(g.moderation_role)):
        return jsonify({"msg": "Recurso no encontrado"}), 404
    key, private = _queue.storage_ref(attachment_id, subject)
    storage = current_app.extensions.get("private_storage")
    if not private or storage is None:
        return jsonify({"msg": "Este archivo no está en el almacenamiento privado"}), 404
    return jsonify({
        "url": storage.signed_url(key, "image/webp", PREVIEW_URL_TTL_SECONDS),
        "expires_in": PREVIEW_URL_TTL_SECONDS,
    }), 200


@content_moderation_bp.route("/moderation/media/<uuid:attachment_id>/decision", methods=["POST"])
@moderation_role_required()
def decision(attachment_id):
    subject = _subject()
    if subject is None:
        return _bad_type()
    data = request.get_json(silent=True) or {}
    try:
        result = uc.decide(
            attachment_id, get_jwt_identity(), data.get("decision"), data.get("note"),
            g.moderation_role, _queue, _repository, _users, _now(), subject_type=subject,
        )
    except (uc.NotFoundError, uc.InvalidRequestError) as error:
        return _error(error)
    return jsonify(result), 200


@content_moderation_bp.route("/moderation/stats", methods=["GET"])
@moderation_role_required()
def stats():
    return jsonify(uc.stats(g.moderation_role, _queue)), 200


# --- Solo admin: auditoría y trabajos --------------------------------------------------------


@content_moderation_bp.route("/moderation/audit", methods=["GET"])
@moderation_role_required(roles.ADMIN)
def audit():
    try:
        return jsonify(
            uc.audit_page(request.args.get("limit"), request.args.get("offset"), _queue)
        ), 200
    except uc.InvalidRequestError as error:
        return _error(error)


@content_moderation_bp.route("/moderation/jobs", methods=["GET"])
@moderation_role_required(roles.ADMIN)
def jobs():
    try:
        return jsonify(uc.list_jobs(
            request.args.get("status"), request.args.get("limit"), request.args.get("offset"),
            _queue,
        )), 200
    except uc.InvalidRequestError as error:
        return _error(error)


@content_moderation_bp.route("/moderation/jobs/<uuid:job_id>/retry", methods=["POST"])
@moderation_role_required(roles.ADMIN)
def retry(job_id):
    try:
        return jsonify(uc.retry_job(job_id, get_jwt_identity(), _queue, _repository, _now())), 200
    except uc.NotFoundError as error:
        return _error(error)


# --- Apelaciones: moderación ------------------------------------------------------------------


@content_moderation_bp.route("/moderation/appeals", methods=["GET"])
@moderation_role_required()
def appeals():
    try:
        return jsonify(uc.list_appeals(
            request.args.get("status"), request.args.get("limit"), request.args.get("offset"),
            g.moderation_role, _queue,
        )), 200
    except uc.InvalidRequestError as error:
        return _error(error)


@content_moderation_bp.route("/moderation/appeals/<uuid:appeal_id>/resolve", methods=["POST"])
@moderation_role_required()
def resolve(appeal_id):
    data = request.get_json(silent=True) or {}
    try:
        result = uc.resolve_appeal(
            appeal_id, get_jwt_identity(), data.get("outcome"), data.get("note"),
            g.moderation_role, _queue, _repository, _now(),
        )
    except (uc.NotFoundError, uc.InvalidRequestError, uc.ConflictError, uc.ForbiddenError) as error:
        return _error(error)
    return jsonify(result), 200


# --- Apelaciones: la persona afectada --------------------------------------------------------


@content_moderation_bp.route("/appeals", methods=["POST"])
@feature_required
def create_appeal():
    user_id = get_jwt_identity()
    data = request.get_json(silent=True) or {}
    try:
        rate_limit_guard.enforce(
            policy.MODERATION_APPEAL, f"user:{user_id}", _rate_limit_repository
        )
    except RateLimitExceededError as error:
        return rate_limited_response(error)
    try:
        try:
            attachment_id = str(uuid.UUID(data.get("attachment_id")))
        except (ValueError, AttributeError, TypeError):
            raise uc.InvalidRequestError("attachment_id debe ser un identificador válido")
        subject = subjects.FROM_QUERY.get(data.get("type") or "media")
        if subject is None:
            raise uc.InvalidRequestError("type debe ser media o story")
        result = uc.create_appeal(
            user_id, attachment_id, data.get("reason"), _queue, _repository, subject_type=subject,
            events=_events,
        )
    except (
        uc.InvalidRequestError, uc.NotFoundError, uc.ConflictError, uc.TooManyAppealsError,
    ) as error:
        return _error(error)
    return jsonify(result), 201


@content_moderation_bp.route("/appeals", methods=["GET"])
@feature_required
def my_appeals():
    return jsonify(uc.my_appeals(get_jwt_identity(), _queue)), 200
