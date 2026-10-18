# Autorización de las rutas de moderación de contenido (ADR-044 §2.5–§2.6). Se comprueba EN EL
# SERVIDOR contra la base en cada petición: ocultar botones no es un control.
#
#   * Con `MODERATION_ENABLED` apagado, estas rutas no existen (404).
#   * Quien no tiene un rol permitido recibe el mismo 404 que una URL inexistente.
#   * Con `MODERATION_REQUIRE_2FA` encendido, la cuenta moderadora necesita 2FA activa (403 con
#     código, para que sepa qué hacer: a diferencia de un desconocido, ella ya es de confianza).

from functools import wraps

from flask import current_app, g, jsonify
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.domain.content_moderation import roles
from app.infrastructure.persistence.repositories.moderation_repository import (
    SQLAlchemyModerationRepository,
)

_moderation_repository = SQLAlchemyModerationRepository()


def _not_found():
    return jsonify({"msg": "Recurso no encontrado"}), 404


def feature_enabled():
    return bool(current_app.config.get("MODERATION_ENABLED"))


def moderation_role_required(*allowed):
    """`allowed` vacío = cualquier rol de moderación. El rol efectivo queda en `g.moderation_role`."""

    def decorator(view):
        @wraps(view)
        @jwt_required()
        def wrapper(*args, **kwargs):
            if not feature_enabled():
                return _not_found()
            user = _moderation_repository.get_user(get_jwt_identity())
            role = None if user is None else roles.effective_role(
                user.is_moderator, user.moderation_role, user.suspended_at is not None
            )
            if role is None or (allowed and role not in allowed):
                return _not_found()
            if current_app.config.get("MODERATION_REQUIRE_2FA") and not user.two_factor_enabled:
                return jsonify({
                    "msg": "Activa la verificación en dos pasos para moderar",
                    "code": "two_factor_required",
                }), 403
            g.moderation_role = role
            return view(*args, **kwargs)

        return wrapper

    return decorator


def feature_required(view):
    """Para rutas de personas comunes (apelar): solo exige que la moderación esté encendida."""

    @wraps(view)
    @jwt_required()
    def wrapper(*args, **kwargs):
        if not feature_enabled():
            return _not_found()
        return view(*args, **kwargs)

    return wrapper
