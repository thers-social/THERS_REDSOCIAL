# GET /api/media/<path> -- sirve las imágenes de perfil guardadas en disco
# (ADR-015-profile-media.md). Solo se registra con STORAGE_BACKEND=local; en
# staging/producción las sirve el proveedor S3-compatible. Público a
# propósito (son fotos de perfil, igual que en cualquier red social), pero
# solo dentro del directorio de uploads y con nombres aleatorios.

from flask import Blueprint, current_app, send_from_directory

media_bp = Blueprint("media", __name__)


@media_bp.route("/media/<path:filename>", methods=["GET"])
def serve_media(filename):
    response = send_from_directory(current_app.config["UPLOAD_DIR"], filename)
    # Notas de voz (ADR-042): el tipo que adivina el sistema para .m4a varía (audio/x-m4a,
    # audio/mp4a-latm…) y Safari es quisquilloso: siempre audio/mp4.
    if filename.endswith(".m4a"):
        response.mimetype = "audio/mp4"
    response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response
