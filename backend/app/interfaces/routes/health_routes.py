# GET /api/health -- sonda de vida y de dependencias para Render/uptime monitors.
#
# Pública y sin JWT a propósito: el monitor externo no tiene sesión. No expone
# versiones, rutas ni mensajes de error de la base (solo "ok"/"degraded"), para
# no darle información a un atacante. Responde 503 si la base no contesta, de
# modo que Render pueda reiniciar/retirar la instancia.

from flask import Blueprint, jsonify
from sqlalchemy import text

from app.extensions import db

health_bp = Blueprint("health", __name__)


@health_bp.route("/health", methods=["GET"])
def health():
    try:
        db.session.execute(text("SELECT 1"))
    except Exception:  # noqa: BLE001 -- cualquier fallo de la base es "degraded"
        db.session.rollback()
        response = jsonify({"status": "degraded"})
        response.status_code = 503
    else:
        response = jsonify({"status": "ok"})
    response.headers["Cache-Control"] = "no-store"
    return response
