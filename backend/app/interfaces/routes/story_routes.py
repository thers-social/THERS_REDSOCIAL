# Historias de 24 horas (ADR-042-stories.md):
#   POST   /api/stories                    publicar (multipart: `image` + `content` y `audience` opcionales)
#   GET    /api/stories                    la tira: quién tiene historias vigentes
#   GET    /api/users/<id>/stories         historias vigentes de una persona
#   POST   /api/stories/<id>/view          registrar la vista (idempotente)
#   GET    /api/stories/<id>/views         quién la vio (solo quien la publicó)
#   DELETE /api/stories/<id>               borrar la propia
# Composition root, igual que el resto de interfaces/routes/ (BACKEND_ARCHITECTURE.md §17).

from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.application.rate_limiting import rate_limit_guard
from app.application.stories import story_use_cases as stories
from app.domain.media.storage import ImageTooLargeError, InvalidImageError
from app.domain.rate_limiting import policy
from app.domain.rate_limiting.exceptions import RateLimitExceededError
from app.domain.stories.rules import (
    MAX_STORY_TEXT,
    StoryAudienceInvalidError,
    StoryNotFoundError,
    StoryTextInvalidError,
)
from app.infrastructure.media.image_processor import MAX_UPLOAD_BYTES, process_attachment
from app.infrastructure.persistence.repositories.rate_limit_repository import (
    SQLAlchemyRateLimitRepository,
)
from app.infrastructure.persistence.repositories.story_repository import SQLAlchemyStoryRepository
from app.interfaces.profile_gate import profile_completed_required
from app.interfaces.rate_limited_response import rate_limited_response

stories_bp = Blueprint("stories", __name__)

_story_repository = SQLAlchemyStoryRepository()
_rate_limit_repository = SQLAlchemyRateLimitRepository()

#: Una imagen de 5 MiB más el sobrecoste del formato multipart.
_MULTIPART_LIMIT_BYTES = 7 * 1024 * 1024


@stories_bp.before_request
def _module_disabled():
    # Interruptor STORIES_ENABLED (apagado por defecto). Corre ANTES de la autenticación y de
    # cualquier lectura, así que apagado no se publica, no se lista y no se expone nada, y quien
    # no tiene sesión recibe lo mismo que una URL inexistente (idéntico a `error_handlers.py`).
    if not current_app.config.get("STORIES_ENABLED", False):
        return jsonify({"msg": "Recurso no encontrado"}), 404
    return None


def _not_found():
    return jsonify({"msg": "Historia no encontrada"}), 404


def _private_storage():
    return current_app.extensions.get("private_storage")


def _private_files():
    """`STORIES_PRIVATE_STORAGE` (apagado por defecto): las historias NUEVAS se guardan en el
    almacenamiento privado. Las anteriores siguen siendo públicas."""
    return bool(current_app.config.get("STORIES_PRIVATE_STORAGE"))


@stories_bp.route("/stories", methods=["POST"])
@jwt_required()
@profile_completed_required
def create():
    author_id = get_jwt_identity()

    if request.mimetype != "multipart/form-data":
        return jsonify({"msg": "Envía la imagen como multipart/form-data en el campo `image`"}), 400
    # Se fija ANTES de leer el cuerpo, que es cuando Werkzeug aplica el tope.
    request.max_content_length = _MULTIPART_LIMIT_BYTES

    upload = request.files.get("image")
    if upload is None or upload.filename == "":
        return jsonify({"msg": "Falta la imagen de la historia"}), 400

    try:
        rate_limit_guard.enforce(policy.STORY_CREATE, f"user:{author_id}", _rate_limit_repository)
    except RateLimitExceededError as error:
        return rate_limited_response(error)

    try:
        raw = upload.read(MAX_UPLOAD_BYTES + 1)
        prepared = process_attachment(raw, "story")
    except InvalidImageError:
        return jsonify({"msg": "El archivo debe ser una imagen JPEG, PNG o WebP válida"}), 400
    except ImageTooLargeError:
        return jsonify({"msg": "La imagen puede pesar como máximo 5 MB"}), 413

    try:
        story = stories.create_story(
            author_id,
            request.form.get("content"),
            prepared,
            _story_repository,
            current_app.extensions["media_storage"],
            private_storage=_private_storage(),
            private_files=_private_files(),
            audience=request.form.get("audience"),
        )
    except stories.PrivateStorageUnavailableError:
        return jsonify({"msg": "El almacenamiento privado no está disponible"}), 503
    except StoryAudienceInvalidError:
        return jsonify({"msg": "La audiencia debe ser `everyone` o `close_friends`"}), 400
    except StoryTextInvalidError:
        return jsonify({"msg": f"El texto puede tener como máximo {MAX_STORY_TEXT} caracteres"}), 400
    return jsonify({"story": story}), 201


@stories_bp.route("/stories", methods=["GET"])
@jwt_required()
def strip():
    return jsonify({"authors": stories.list_strip(
        get_jwt_identity(), _story_repository, private_storage=_private_storage()
    )}), 200


@stories_bp.route("/users/<uuid:user_id>/stories", methods=["GET"])
@jwt_required()
def for_user(user_id):
    items = stories.list_for_author(
        user_id, get_jwt_identity(), _story_repository, private_storage=_private_storage()
    )
    return jsonify({"stories": items}), 200


@stories_bp.route("/stories/<uuid:story_id>/view", methods=["POST"])
@jwt_required()
def view(story_id):
    try:
        return jsonify(stories.record_view(story_id, get_jwt_identity(), _story_repository)), 200
    except StoryNotFoundError:
        return _not_found()


@stories_bp.route("/stories/<uuid:story_id>/views", methods=["GET"])
@jwt_required()
def views(story_id):
    try:
        return jsonify(stories.list_views(story_id, get_jwt_identity(), _story_repository)), 200
    except StoryNotFoundError:
        return _not_found()


@stories_bp.route("/stories/<uuid:story_id>", methods=["DELETE"])
@jwt_required()
def delete(story_id):
    try:
        result = stories.delete_story(
            story_id,
            get_jwt_identity(),
            _story_repository,
            current_app.extensions["media_storage"],
            private_storage=_private_storage(),
        )
    except StoryNotFoundError:
        return _not_found()
    return jsonify(result), 200
