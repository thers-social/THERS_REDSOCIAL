# Reels con Mux (ADR-043, ADR-043-A):
#   POST   /api/videos/uploads     reservar una subida directa a Mux (solo la lista de prueba, D3)
#   GET    /api/videos             Reels que puedes ver (listos Y aprobados)
#   GET    /api/videos/mine        los tuyos, con su estado
#   GET    /api/videos/<id>        uno (con token de reproducción firmado, por espectador)
#   DELETE /api/videos/<id>        borrar uno tuyo (el asset de Mux se borra por cola, con reintentos)
#   GET    /api/videos/saved                       tus Reels guardados (ADR-055)
#   POST/DELETE /api/videos/<id>/like|save         me gusta / guardar, idempotentes (ADR-055)
#   GET/POST /api/videos/<id>/comments             comentarios (ADR-055)
#   DELETE /api/videos/<id>/comments/<comment_id>  borrar uno (su autor o la persona dueña del Reel)
#   POST   /api/webhooks/mux       eventos de Mux (firma HMAC; sin JWT)
#
# Todo responde 404 mientras `VIDEOS_ENABLED` esté apagado (por defecto), también el webhook.
# Composition root, igual que el resto de interfaces/routes/ (BACKEND_ARCHITECTURE.md §17).

from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.application.rate_limiting import rate_limit_guard
from app.application.videos import video_use_cases as uc
from app.domain.rate_limiting import policy
from app.domain.rate_limiting.exceptions import RateLimitExceededError
from app.domain.videos import rules
from app.infrastructure.persistence.repositories.rate_limit_repository import (
    SQLAlchemyRateLimitRepository,
)
from app.infrastructure.persistence.repositories.video_repository import SQLAlchemyVideoRepository
from app.interfaces.profile_gate import profile_completed_required
from app.interfaces.rate_limited_response import rate_limited_response

videos_bp = Blueprint("videos", __name__)

_repository = SQLAlchemyVideoRepository()
_rate_limit_repository = SQLAlchemyRateLimitRepository()


@videos_bp.before_request
def _module_disabled():
    # Antes de autenticar y de leer nada: apagado no existe (ni para quien no tiene sesión).
    if not current_app.config.get("VIDEOS_ENABLED", False):
        return jsonify({"msg": "Recurso no encontrado"}), 404
    return None


def _not_found():
    return jsonify({"msg": "Video no encontrado"}), 404


def _mux():
    return current_app.extensions.get("mux_client")


def _signer():
    return current_app.extensions.get("video_playback_signer")


def _human_review_only():
    """`True` si la moderación está encendida y no hay clasificador automático: todo queda retenido
    hasta que una persona lo aprueba (D3, `domain/videos/rules.py`)."""
    config = current_app.config
    return bool(config.get("MODERATION_ENABLED")) and config.get("MODERATION_CLASSIFIER") != "fake"


@videos_bp.route("/videos/uploads", methods=["POST"])
@jwt_required()
@profile_completed_required
def create_upload():
    owner_id = get_jwt_identity()
    data = request.get_json(silent=True) or {}
    try:
        rate_limit_guard.enforce(policy.VIDEO_UPLOAD, f"user:{owner_id}", _rate_limit_repository)
    except RateLimitExceededError as error:
        return rate_limited_response(error)
    try:
        result = uc.create_upload(
            owner_id, data.get("caption"),
            request.headers.get("Idempotency-Key") or data.get("idempotency_key"),
            _repository, _mux(),
            rules.parse_allowlist(current_app.config.get("VIDEO_UPLOAD_ALLOWLIST")),
            current_app.config.get("MUX_CORS_ORIGIN"),
            _human_review_only(),
        )
    except rules.VideoUploadNotAllowedError:
        # D3: para el resto de las cuentas el módulo no existe.
        return jsonify({"msg": "Recurso no encontrado"}), 404
    except rules.VideoInvalidError as error:
        return jsonify({"msg": error.message}), 400
    except rules.ProviderUnavailableError:
        return jsonify({"msg": "El servicio de video no está disponible"}), 503
    created = result.pop("created")
    return jsonify({"video": result}), 201 if created else 200


@videos_bp.route("/videos", methods=["GET"])
@jwt_required()
def list_all():
    try:
        return jsonify(uc.list_videos(
            get_jwt_identity(), request.args.get("author"), request.args.get("limit"),
            request.args.get("offset"), _repository, _signer(),
        )), 200
    except rules.VideoInvalidError as error:
        return jsonify({"msg": error.message}), 400


@videos_bp.route("/videos/mine", methods=["GET"])
@jwt_required()
def mine():
    return jsonify(uc.list_mine(get_jwt_identity(), _repository, _signer())), 200


@videos_bp.route("/videos/<uuid:video_id>", methods=["GET"])
@jwt_required()
def get_one(video_id):
    try:
        return jsonify({"video": uc.get_video(video_id, get_jwt_identity(), _repository, _signer())}), 200
    except rules.VideoNotFoundError:
        return _not_found()


@videos_bp.route("/videos/<uuid:video_id>", methods=["DELETE"])
@jwt_required()
def delete_one(video_id):
    try:
        return jsonify(uc.delete_video(video_id, get_jwt_identity(), _repository)), 200
    except rules.VideoNotFoundError:
        return _not_found()


# --- Interacciones (ADR-055) -------------------------------------------------------------------------


@videos_bp.route("/videos/saved", methods=["GET"])
@jwt_required()
def saved():
    try:
        return jsonify(uc.list_saved(
            get_jwt_identity(), request.args.get("limit"), request.args.get("offset"),
            _repository, _signer(),
        )), 200
    except rules.VideoInvalidError as error:
        return jsonify({"msg": error.message}), 400


@videos_bp.route("/videos/<uuid:video_id>/like", methods=["POST", "DELETE"])
@jwt_required()
@profile_completed_required
def like(video_id):
    try:
        return jsonify(uc.set_like(video_id, get_jwt_identity(), request.method == "POST", _repository)), 200
    except rules.VideoNotFoundError:
        return _not_found()


@videos_bp.route("/videos/<uuid:video_id>/save", methods=["POST", "DELETE"])
@jwt_required()
@profile_completed_required
def save(video_id):
    try:
        return jsonify(uc.set_save(video_id, get_jwt_identity(), request.method == "POST", _repository)), 200
    except rules.VideoNotFoundError:
        return _not_found()


@videos_bp.route("/videos/<uuid:video_id>/comments", methods=["GET"])
@jwt_required()
def list_comments(video_id):
    try:
        return jsonify(uc.list_comments(
            video_id, get_jwt_identity(), request.args.get("limit"), request.args.get("offset"),
            _repository,
        )), 200
    except rules.VideoNotFoundError:
        return _not_found()
    except rules.VideoInvalidError as error:
        return jsonify({"msg": error.message}), 400


@videos_bp.route("/videos/<uuid:video_id>/comments", methods=["POST"])
@jwt_required()
@profile_completed_required
def create_comment(video_id):
    author_id = get_jwt_identity()
    data = request.get_json(silent=True) or {}
    try:
        rate_limit_guard.enforce(policy.VIDEO_COMMENT, f"user:{author_id}", _rate_limit_repository)
    except RateLimitExceededError as error:
        return rate_limited_response(error)
    try:
        comment = uc.create_comment(video_id, author_id, data.get("content"), _repository)
    except rules.VideoNotFoundError:
        return _not_found()
    except rules.VideoInvalidError as error:
        return jsonify({"msg": error.message}), 400
    return jsonify({"comment": comment}), 201


@videos_bp.route("/videos/<uuid:video_id>/comments/<uuid:comment_id>", methods=["DELETE"])
@jwt_required()
def delete_comment(video_id, comment_id):
    try:
        return jsonify(uc.delete_comment(video_id, comment_id, get_jwt_identity(), _repository)), 200
    except rules.VideoNotFoundError:
        return _not_found()
    except rules.VideoCommentNotFoundError:
        return jsonify({"msg": "Comentario no encontrado"}), 404


@videos_bp.route("/webhooks/mux", methods=["POST"])
def mux_webhook():
    secret = current_app.config.get("MUX_WEBHOOK_SECRET")
    if not secret:
        # Sin secreto no se acepta nada: la ruta no existe.
        return jsonify({"msg": "Recurso no encontrado"}), 404
    try:
        result = uc.handle_webhook(
            request.get_data(), request.headers.get("Mux-Signature"), secret, _repository
        )
    except (uc.InvalidSignatureError, uc.InvalidWebhookError):
        # 400 sin detalle: no se explica por qué falló la firma.
        return jsonify({"msg": "Solicitud inválida"}), 400
    return jsonify(result), 200
