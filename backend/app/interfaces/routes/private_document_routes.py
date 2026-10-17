# GET /api/private-documents/<token> -- descarga de un documento privado de reclamo con
# STORAGE_BACKEND=local (ADR-040 fase 6). El token está firmado y caduca a los 5 minutos; solo
# se entrega a moderación (`POST /api/moderation/place-claims/<id>/document-url`). Con S3 esta
# ruta no existe: el proveedor sirve la URL prefirmada. Nunca se cachea y siempre es descarga.

from flask import Blueprint, Response, current_app, jsonify

from app.domain.claims import kinds

private_documents_bp = Blueprint("private_documents", __name__)


@private_documents_bp.route("/private-documents/<token>", methods=["GET"])
def serve_private_document(token):
    storage = current_app.extensions.get("private_storage")
    found = storage.read_signed(token, kinds.DOCUMENT_URL_TTL_SECONDS) if storage else None
    if found is None:
        return jsonify({"msg": "Recurso no encontrado"}), 404
    data, content_type = found
    response = Response(data, mimetype=content_type)
    response.headers["Content-Disposition"] = "attachment"
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response
