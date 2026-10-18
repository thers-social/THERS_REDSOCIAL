# GET /api/media/<path> -- sirve las imágenes de perfil guardadas en disco
# (ADR-015-profile-media.md). Solo se registra con STORAGE_BACKEND=local; en
# staging/producción las sirve el proveedor S3-compatible. Público a
# propósito (son fotos de perfil, igual que en cualquier red social), pero
# solo dentro del directorio de uploads y con nombres aleatorios.

from flask import Blueprint, abort, current_app, send_from_directory

from app.infrastructure.persistence.repositories.content_moderation_repository import (
    SQLAlchemyContentModerationRepository,
)

media_bp = Blueprint("media", __name__)
_moderation_repository = SQLAlchemyContentModerationRepository()


@media_bp.route("/media/<path:filename>", methods=["GET"])
def serve_media(filename):
    # Moderación (ADR-044): con ella encendida el ARCHIVO de una imagen que no está aprobada no se
    # sirve, aunque alguien conozca el nombre. Es autorización efectiva, no solo ocultar la URL.
    # (Con un bucket público de S3 esto no aplica: ver ADR-044, almacenamiento privado.)
    if current_app.config.get("MODERATION_ENABLED") and _moderation_repository.is_withheld(filename):
        abort(404)
    response = send_from_directory(current_app.config["UPLOAD_DIR"], filename)
    response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response
