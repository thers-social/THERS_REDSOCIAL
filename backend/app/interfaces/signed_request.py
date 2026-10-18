# Autenticación de la API interna de n8n (ADR-041 §7): firma HMAC, NO JWT.
#
# n8n no es una persona y no debe tener una cuenta ni un token que pueda actuar como alguien: lo que
# puede pedir son operaciones concretas y limitadas, y solo con una firma válida del secreto
# compartido. Esto NO sustituye la autorización del negocio: cada operación decide por sí misma qué
# devuelve y a quién (el backend es la fuente de verdad).
#
# Orden deliberado de las comprobaciones:
#   1. apagado o sin secreto -> 404, como si la ruta no existiera (no se anuncia que hay una API
#      interna que nadie configuró);
#   2. firma o marca de tiempo inválidas -> 401 con un mensaje fijo, sin decir cuál de las dos.

import time
from functools import wraps

from flask import current_app, jsonify, request

from app.domain.automations import signing


def require_signature(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        config = current_app.config
        secret = config.get("N8N_WEBHOOK_SECRET")
        if not config.get("TERO_AUTOMATIONS_ENABLED") or not secret:
            return jsonify({"msg": "Recurso no encontrado"}), 404

        valid = signing.verify(
            secret,
            request.headers.get(signing.TIMESTAMP_HEADER),
            request.headers.get(signing.SIGNATURE_HEADER),
            request.get_data(cache=True),
            time.time(),
        )
        if not valid:
            return jsonify({"msg": "Firma inválida"}), 401
        return view(*args, **kwargs)

    return wrapper
