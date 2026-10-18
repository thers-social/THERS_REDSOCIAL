# Decorador de las rutas de moderación (ADR-032 §3).
#
# Una persona que NO es moderadora recibe el mismo `404` que una URL que no existe:
# las rutas de moderación no deben anunciar que están ahí. Mismo criterio que el
# 404 indistinguible de ADR-019/ADR-020 y el de `POST /api/reports`.
#
# Una cuenta moderadora suspendida tampoco pasa: el rol no sobrevive a la suspensión.

from functools import wraps

from flask import current_app, jsonify
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.infrastructure.persistence.repositories.moderation_repository import (
    SQLAlchemyModerationRepository,
)

_moderation_repository = SQLAlchemyModerationRepository()


def moderator_required(view):
    @wraps(view)
    @jwt_required()
    def wrapper(*args, **kwargs):
        user = _moderation_repository.get_user(get_jwt_identity())
        if user is None or not user.is_moderator or user.suspended_at is not None:
            # Idéntico al manejador global de `error_handlers.py`.
            return jsonify({"msg": "Recurso no encontrado"}), 404
        # ADR-044 decisión 5: con MODERATION_REQUIRE_2FA la cuenta moderadora necesita 2FA activa.
        if current_app.config.get("MODERATION_REQUIRE_2FA") and not user.two_factor_enabled:
            return jsonify({
                "msg": "Activa la verificación en dos pasos para moderar",
                "code": "two_factor_required",
            }), 403
        return view(*args, **kwargs)

    return wrapper
