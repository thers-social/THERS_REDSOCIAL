# Dispositivos para notificaciones push (ADR-053):
#   POST   /api/push/devices   registra el token de Firebase de este teléfono para la persona con sesión
#   DELETE /api/push/devices   lo quita (cerrar sesión); solo borra un dispositivo propio
#
# La identidad sale del JWT. El token es un dato del dispositivo, no un secreto de la cuenta, pero se
# valida el formato y el tamaño y NUNCA se devuelve en una respuesta.

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.infrastructure.persistence.repositories.push_device_repository import (
    SQLAlchemyPushDeviceRepository,
)

push_bp = Blueprint("push", __name__)

_devices = SQLAlchemyPushDeviceRepository()

MIN_TOKEN, MAX_TOKEN = 20, 4096
PLATFORMS = ("android", "ios")


def _token_from(data):
    token = (data or {}).get("token")
    if not isinstance(token, str) or not (MIN_TOKEN <= len(token) <= MAX_TOKEN) or any(c.isspace() for c in token):
        return None
    return token


@push_bp.route("/push/devices", methods=["POST"])
@jwt_required()
def register_device():
    data = request.get_json(silent=True) or {}
    token = _token_from(data)
    if token is None:
        return jsonify({"msg": "token no es válido"}), 400
    platform = data.get("platform", "android")
    if platform not in PLATFORMS:
        return jsonify({"msg": "platform debe ser android o ios"}), 400
    _devices.register(get_jwt_identity(), token, platform)
    return jsonify({"registered": True}), 200


@push_bp.route("/push/devices", methods=["DELETE"])
@jwt_required()
def unregister_device():
    token = _token_from(request.get_json(silent=True))
    if token is None:
        return jsonify({"msg": "token no es válido"}), 400
    # Idempotente: quitar un dispositivo que ya no está también responde 200.
    _devices.unregister(get_jwt_identity(), token)
    return jsonify({"registered": False}), 200
