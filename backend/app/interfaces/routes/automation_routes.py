# API interna que usa n8n (ADR-041 §7). NO es parte del contrato público con la app: la llama
# n8n, firmada con HMAC (`interfaces/signed_request.py`), y está apagada salvo que
# `TERO_AUTOMATIONS_ENABLED` y el secreto estén configurados.
#
#   POST /api/internal/automations/weekly-summaries/next   cuerpo {limit?, after?}
#        -> a quién enviarle el resumen de la semana ya terminada, con conteos (nunca contenido)
#   POST /api/internal/automations/weekly-summaries/ack    cuerpo {items: [{user_id,
#        idempotency_key, status: "sent"|"failed"}]}
#        -> n8n confirma qué envió; el backend lo marca (idempotente)
#
# Nada de aquí da acceso a la base de datos: son dos operaciones cerradas.

from datetime import datetime, timezone

from flask import Blueprint, jsonify, request

from app.application.automations import weekly_summary
from app.infrastructure.persistence.repositories.automation_repository import (
    SQLAlchemyAutomationRepository,
)
from app.interfaces.signed_request import require_signature

automation_bp = Blueprint("automation", __name__)

_repository = SQLAlchemyAutomationRepository()


def _json_body():
    return request.get_json(silent=True)


@automation_bp.route("/internal/automations/weekly-summaries/next", methods=["POST"])
@require_signature
def weekly_summaries_next():
    try:
        result = weekly_summary.next_batch(_json_body(), datetime.now(timezone.utc), _repository)
    except weekly_summary.InvalidBatchRequestError as error:
        return jsonify({"msg": error.message}), 400
    response = jsonify(result)
    response.headers["Cache-Control"] = "no-store"
    return response, 200


@automation_bp.route("/internal/automations/weekly-summaries/ack", methods=["POST"])
@require_signature
def weekly_summaries_ack():
    try:
        result = weekly_summary.acknowledge(_json_body(), datetime.now(timezone.utc), _repository)
    except weekly_summary.InvalidBatchRequestError as error:
        return jsonify({"msg": error.message}), 400
    response = jsonify(result)
    response.headers["Cache-Control"] = "no-store"
    return response, 200
