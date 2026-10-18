# GET y PATCH /api/users/me/privacy, y GET/POST/DELETE
# /api/users/me/muted-keywords (ADR-022-private-accounts.md,
# ADR-023-mentions.md, ADR-024-content-filters-and-privacy-preferences.md).
#
# Blueprint propio, separado de users_bp: `PATCH /api/users/me` (ADR-003) es el
# contrato del perfil público y tiene reglas que no aplican acá (el cooldown de
# 30 días del username, el 409 por username duplicado). Meter las siete
# preferencias de privacidad en esa misma route daría una whitelist de doce
# campos con dos juegos de validación mezclados.
#
# Las dos rutas van bajo `/users/me/...` y no bajo `/privacy`: siempre operan
# sobre el usuario autenticado, igual que `/users/me` -- `me` es el recurso y
# la privacidad es una faceta suya.
#
# Composition root igual que el resto de interfaces/routes/
# (BACKEND_ARCHITECTURE.md §17).

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.application.moderation.muted_keywords_use_case import (
    add_muted_keyword,
    list_muted_keywords,
    remove_muted_keyword,
)
from app.application.privacy.privacy_settings_use_case import (
    get_privacy_settings,
    update_privacy_settings,
)
from app.domain.auth.exceptions import UserNotFoundError
from app.domain.moderation.exceptions import (
    KeywordLimitReachedError,
    MutedKeywordNotFoundError,
)
from app.domain.moderation.keyword_matching import (
    MAX_KEYWORD_LENGTH,
    MAX_KEYWORDS_PER_USER,
    normalize_keyword,
)
from app.domain.privacy.audience import VALID_AUDIENCES, is_valid_audience
from app.infrastructure.persistence.repositories.follow_repository import (
    SQLAlchemyFollowRepository,
)
from app.infrastructure.persistence.repositories.muted_keyword_repository import (
    SQLAlchemyMutedKeywordRepository,
)
from app.infrastructure.persistence.repositories.user_repository import (
    SQLAlchemyUserRepository,
)

privacy_bp = Blueprint("privacy", __name__)

_user_repository = SQLAlchemyUserRepository()
_follow_repository = SQLAlchemyFollowRepository()
_muted_keyword_repository = SQLAlchemyMutedKeywordRepository()

# Whitelist explícita de campos editables, declarada como dato y no como una
# cadena de `if`s: cada entrada dice qué columna es y cómo se valida. Añadir una
# preferencia nueva es una línea acá, y es imposible que se cuele una columna
# que no esté en esta tabla (mismo principio anti mass-assignment que
# PATCH /api/users/me, ADR-003 §Seguridad).
_BOOLEAN_FIELDS = (
    "is_private",
    "hide_offensive_comments",
    "show_activity_status",
    # ADR-030-content-preferences.md
    "hide_sensitive_content",
    # ADR-041 §7: resumen semanal por correo (n8n). Apagado por defecto.
    "weekly_summary_email",
)
_AUDIENCE_FIELDS = (
    "who_can_mention",
    "who_can_message",
)


@privacy_bp.route("/users/me/privacy", methods=["GET"])
@jwt_required()
def get_privacy():
    # Identidad exclusivamente del JWT -- nadie lee la privacidad de otro.
    user_id = get_jwt_identity()

    try:
        settings = get_privacy_settings(user_id, _user_repository, _follow_repository)
    except UserNotFoundError:
        return jsonify({"msg": "Usuario no encontrado"}), 404

    return jsonify({"privacy": settings}), 200


@privacy_bp.route("/users/me/privacy", methods=["PATCH"])
@jwt_required()
def patch_privacy():
    user_id = get_jwt_identity()

    data = request.get_json(silent=True)
    if not data:
        return jsonify({"msg": "No se recibió ningún campo para actualizar"}), 400

    fields = {}

    for field in _BOOLEAN_FIELDS:
        if field in data:
            value = data.get(field)
            # `isinstance(value, bool)` y no truthiness: aceptar "false" (que
            # en Python es verdadero) dejaría a alguien creyendo que cerró su
            # cuenta cuando la abrió.
            if not isinstance(value, bool):
                return jsonify({"msg": f"`{field}` debe ser true o false"}), 400
            fields[field] = value

    for field in _AUDIENCE_FIELDS:
        if field in data:
            value = data.get(field)
            if not isinstance(value, str) or not is_valid_audience(value):
                return jsonify(
                    {"msg": f"`{field}` debe ser uno de: {', '.join(VALID_AUDIENCES)}"}
                ), 400
            fields[field] = value

    if not fields:
        return jsonify({"msg": "No se recibió ningún campo para actualizar"}), 400

    try:
        settings = update_privacy_settings(
            user_id, fields, _user_repository, _follow_repository
        )
    except UserNotFoundError:
        return jsonify({"msg": "Usuario no encontrado"}), 404

    return jsonify({"privacy": settings}), 200


@privacy_bp.route("/users/me/muted-keywords", methods=["GET"])
@jwt_required()
def get_muted_keywords():
    user_id = get_jwt_identity()
    return jsonify(list_muted_keywords(user_id, _muted_keyword_repository)), 200


@privacy_bp.route("/users/me/muted-keywords", methods=["POST"])
@jwt_required()
def post_muted_keyword():
    user_id = get_jwt_identity()

    data = request.get_json(silent=True)
    if not data:
        return jsonify({"msg": "No se enviaron datos"}), 400

    # Whitelist explícita: solo `keyword`. La normalización (trim + minúsculas)
    # se hace acá, con la misma función que después busca el término en el
    # texto -- si fueran dos criterios distintos, se podría guardar un término
    # que nunca llega a encontrarse (domain/moderation/keyword_matching.py).
    keyword = normalize_keyword(data.get("keyword"))
    if keyword is None:
        return jsonify(
            {"msg": f"El término debe tener entre 1 y {MAX_KEYWORD_LENGTH} caracteres"}
        ), 400

    try:
        result = add_muted_keyword(user_id, keyword, _muted_keyword_repository)
    except KeywordLimitReachedError:
        return jsonify(
            {"msg": f"No podés tener más de {MAX_KEYWORDS_PER_USER} términos filtrados"}
        ), 409

    # 200 y no 201: es idempotente -- agregar un término que ya tenías devuelve
    # el mismo estado, sin crear nada nuevo (mismo criterio que
    # POST /api/posts/<id>/like, ADR-005 §Decisión).
    return jsonify(result), 200


@privacy_bp.route("/users/me/muted-keywords", methods=["DELETE"])
@jwt_required()
def delete_muted_keyword():
    # El término va en el body, no en la URL: puede contener espacios, acentos
    # y `/`, y meterlo en el path obligaría a percent-encoding en los dos lados
    # para nada (ADR-024 §Contrato API). Es el único DELETE del proyecto con
    # body, y es por eso.
    user_id = get_jwt_identity()

    data = request.get_json(silent=True)
    if not data:
        return jsonify({"msg": "No se enviaron datos"}), 400

    keyword = normalize_keyword(data.get("keyword"))
    if keyword is None:
        return jsonify({"msg": "El término no es válido"}), 400

    try:
        result = remove_muted_keyword(user_id, keyword, _muted_keyword_repository)
    except MutedKeywordNotFoundError:
        return jsonify({"msg": "Término no encontrado"}), 404

    return jsonify(result), 200
