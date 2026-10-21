# Endpoints de la pantalla "Preferencias de contenido y feed" (REF-SET-12,
# ADR-030-content-preferences.md):
#   · GET/POST/DELETE /api/users/me/muted-topics   temas silenciados
#   · GET /api/users/suggestions                   cuentas sugeridas
#   · GET /api/users/search?q=                     buscar personas por nombre o usuario
#
# Lo demás de la pantalla ya existía y no se toca: las palabras ocultas son
# `/api/users/me/muted-keywords` (ADR-024) y el filtro de contenido sensible es
# un campo más de `PATCH /api/users/me/privacy`.
#
# Todos protegidos: la identidad sale del JWT. Composition root igual que el
# resto de interfaces/routes/ (BACKEND_ARCHITECTURE.md §17).

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.application.media.media_url import media_url
from app.application.moderation.muted_topics_use_case import (
    add_muted_topic,
    list_muted_topics,
    remove_muted_topic,
)
from app.domain.follows.suggestions import DEFAULT_SUGGESTION_LIMIT
from app.domain.moderation.topic_exceptions import (
    MutedTopicNotFoundError,
    TopicLimitReachedError,
)
from app.domain.moderation.topic_matching import (
    MAX_TOPIC_LENGTH,
    MAX_TOPICS_PER_USER,
    normalize_topic,
)
from app.infrastructure.persistence.repositories.muted_topic_repository import (
    SQLAlchemyMutedTopicRepository,
)
from app.infrastructure.persistence.repositories.suggestion_repository import (
    SQLAlchemySuggestionRepository,
)
from app.infrastructure.persistence.repositories.user_search_repository import (
    SQLAlchemyUserSearchRepository,
)

content_bp = Blueprint("content", __name__)

_muted_topic_repository = SQLAlchemyMutedTopicRepository()
_suggestion_repository = SQLAlchemySuggestionRepository()
_user_search_repository = SQLAlchemyUserSearchRepository()

_MAX_SEARCH_LENGTH = 50
_DEFAULT_SEARCH_LIMIT = 20
_MAX_SEARCH_LIMIT = 30


# ===========================================================================
# Temas silenciados
# ===========================================================================
@content_bp.route("/users/me/muted-topics", methods=["GET"])
@jwt_required()
def get_muted_topics():
    user_id = get_jwt_identity()
    return jsonify(list_muted_topics(user_id, _muted_topic_repository)), 200


@content_bp.route("/users/me/muted-topics", methods=["POST"])
@jwt_required()
def post_muted_topic():
    user_id = get_jwt_identity()

    data = request.get_json(silent=True)
    if not data:
        return jsonify({"msg": "No se enviaron datos"}), 400

    # Whitelist explícita: solo `topic`. La normalización (sin `#`, minúsculas)
    # se hace acá, con la misma función que define qué es un tema válido.
    topic = normalize_topic(data.get("topic"))
    if topic is None:
        return jsonify({
            "msg": (
                f"El tema debe tener entre 1 y {MAX_TOPIC_LENGTH} caracteres, "
                "solo letras, números o guion bajo"
            )
        }), 400

    try:
        result = add_muted_topic(user_id, topic, _muted_topic_repository)
    except TopicLimitReachedError:
        return jsonify(
            {"msg": f"No puedes tener más de {MAX_TOPICS_PER_USER} temas silenciados"}
        ), 409

    # 200 y no 201: idempotente -- silenciar un tema que ya tenías devuelve el
    # mismo estado.
    return jsonify(result), 200


@content_bp.route("/users/me/muted-topics", methods=["DELETE"])
@jwt_required()
def delete_muted_topic():
    # El tema va en el body, igual que en muted-keywords (ADR-024): puede llevar
    # acentos y no hay motivo para obligar a percent-encoding en la URL.
    user_id = get_jwt_identity()

    data = request.get_json(silent=True)
    if not data:
        return jsonify({"msg": "No se enviaron datos"}), 400

    topic = normalize_topic(data.get("topic"))
    if topic is None:
        return jsonify({"msg": "El tema no es válido"}), 400

    try:
        result = remove_muted_topic(user_id, topic, _muted_topic_repository)
    except MutedTopicNotFoundError:
        return jsonify({"msg": "Tema no encontrado"}), 404

    return jsonify(result), 200


# ===========================================================================
# Cuentas sugeridas
# ===========================================================================
@content_bp.route("/users/suggestions", methods=["GET"])
@jwt_required()
def get_suggestions():
    viewer_id = get_jwt_identity()
    # `?limit=` opcional (1–20) para el panel de sugerencias del perfil (ADR-052); sin él, el de siempre.
    try:
        limit = min(max(int(request.args.get("limit", DEFAULT_SUGGESTION_LIMIT)), 1), 20)
    except ValueError:
        return jsonify({"msg": "limit debe ser un número"}), 400
    users = _suggestion_repository.list_for_user(viewer_id, limit)

    # Forma reducida: nunca email/phone/etc. Mismo criterio que el autor de un
    # post (post_presenter.py). `is_private` para que el botón diga «Solicitar»
    # y no «Seguir» cuando corresponde.
    return jsonify({"suggestions": [_person(user) for user in users]}), 200


def _person(user):
    return {
        "id": str(user.id),
        "name": user.name,
        "username": user.username,
        "is_private": user.is_private,
        "avatar_url": media_url(user.avatar_path),
    }


# ===========================================================================
# Buscar personas por nombre o usuario
# ===========================================================================
@content_bp.route("/users/search", methods=["GET"])
@jwt_required()
def search_users():
    viewer_id = get_jwt_identity()
    # `@diego` y `diego` buscan lo mismo. Sin texto no hay búsqueda: lista vacía, no error.
    query = (request.args.get("q") or "").strip().lstrip("@").strip()[:_MAX_SEARCH_LENGTH]
    if not query:
        return jsonify({"users": []}), 200
    try:
        limit = min(max(int(request.args.get("limit", _DEFAULT_SEARCH_LIMIT)), 1), _MAX_SEARCH_LIMIT)
    except ValueError:
        return jsonify({"msg": "limit debe ser un número"}), 400

    # Aparece cualquier persona por nombre o usuario, tenga o no publicaciones. Las exclusiones
    # (uno mismo, bloqueos en cualquier sentido, moderación y suspendidas) viven en el repositorio.
    users = _user_search_repository.search(viewer_id, query, limit)
    return jsonify({"users": [_person(user) for user in users]}), 200
