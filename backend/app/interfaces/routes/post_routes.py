# POST /api/posts y GET /api/posts (ADR-004-posts-minimal-model.md), más
# DELETE /api/posts/<post_id> (ADR-019-post-deletion.md) y
# PATCH /api/posts/<post_id> (ADR-021-content-editing.md).
# Blueprint separado de auth_bp/users_bp -- primer endpoint de una entidad
# social real, no de autenticación ni de perfil. Composition root igual que
# el resto de interfaces/routes/ (BACKEND_ARCHITECTURE.md §17): único punto
# que conoce tanto el caso de uso (application/) como la implementación
# concreta del repositorio (infrastructure/).

from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.application.posts.create_post_use_case import create_post
from app.application.posts.delete_post_use_case import delete_post
from app.application.posts.list_posts_use_case import DEFAULT_LIMIT, list_posts
from app.application.posts.update_post_use_case import update_post
from app.application.rate_limiting import rate_limit_guard
from app.domain.media.attachments import MAX_POST_IMAGES
from app.domain.posts.exceptions import PostNotFoundError
from app.domain.posts.validators import (
    MAX_CONTENT_LENGTH,
    is_valid_content,
    is_valid_content_with_images,
)
from app.domain.rate_limiting import policy
from app.domain.rate_limiting.exceptions import RateLimitExceededError
from app.infrastructure.persistence.repositories.media_attachment_repository import (
    SQLAlchemyMediaAttachmentRepository,
)
from app.infrastructure.persistence.repositories.rate_limit_repository import (
    SQLAlchemyRateLimitRepository,
)
from app.interfaces.image_upload import (
    process_files,
    read_request_data,
    too_many_images_response,
)
from app.interfaces.profile_gate import profile_completed_required
from app.interfaces.rate_limited_response import rate_limited_response
from app.infrastructure.persistence.repositories.comment_repository import (
    SQLAlchemyCommentRepository,
)
from app.infrastructure.persistence.repositories.follow_repository import (
    SQLAlchemyFollowRepository,
)
from app.infrastructure.persistence.repositories.like_repository import (
    SQLAlchemyLikeRepository,
)
from app.infrastructure.persistence.repositories.mention_repository import (
    SQLAlchemyMentionRepository,
)
from app.infrastructure.persistence.repositories.muted_keyword_repository import (
    SQLAlchemyMutedKeywordRepository,
)
from app.infrastructure.persistence.repositories.notification_repository import (
    SQLAlchemyNotificationRepository,
)
from app.infrastructure.persistence.repositories.restriction_repository import (
    SQLAlchemyRestrictionRepository,
)
from app.infrastructure.persistence.repositories.user_repository import (
    SQLAlchemyUserRepository,
)
from app.infrastructure.persistence.repositories.post_repository import (
    SQLAlchemyPostRepository,
)

posts_bp = Blueprint("posts", __name__)

_post_repository = SQLAlchemyPostRepository()
_like_repository = SQLAlchemyLikeRepository()
_comment_repository = SQLAlchemyCommentRepository()
_follow_repository = SQLAlchemyFollowRepository()
# ADR-023-mentions.md (resolver @username al crear/editar) y
# ADR-024-content-filters-and-privacy-preferences.md (términos filtrados del
# espectador al listar).
_user_repository = SQLAlchemyUserRepository()
_mention_repository = SQLAlchemyMentionRepository()
_notification_repository = SQLAlchemyNotificationRepository()
_muted_keyword_repository = SQLAlchemyMutedKeywordRepository()
# ADR-029-blocked-and-restricted-accounts.md: un bloqueo anula la mención.
_restriction_repository = SQLAlchemyRestrictionRepository()
# ADR-039: imágenes adjuntas y su límite de subidas.
_media_repository = SQLAlchemyMediaAttachmentRepository()
_rate_limit_repository = SQLAlchemyRateLimitRepository()


@posts_bp.route("/posts", methods=["POST"])
@jwt_required()
@profile_completed_required
def create():
    # Identidad exclusivamente del JWT -- nunca de query string, body ni
    # headers personalizados (mismo principio que auth_routes.py/user_routes.py).
    author_id = get_jwt_identity()

    # JSON (como siempre) o multipart con imágenes en el campo `images` (ADR-039).
    data, files = read_request_data()
    if not data and not files:
        return jsonify({"msg": "No se enviaron datos"}), 400
    data = data or {}

    if len(files) > MAX_POST_IMAGES:
        return too_many_images_response(MAX_POST_IMAGES)

    # Whitelist explícita: solo `content` (e `is_sensitive`) se leen del body --
    # nunca `author_id`/`id`/`created_at` (mismo principio anti mass-assignment
    # que PATCH /api/users/me, ADR-003 §Seguridad).
    #
    # Con imágenes el texto puede ir vacío (publicar solo una foto); sin ellas
    # sigue siendo obligatorio, igual que antes.
    content = data.get("content")
    content_ok = is_valid_content_with_images(content) if files else is_valid_content(content)
    if not content_ok:
        return jsonify(
            {"msg": f"El contenido debe tener entre 1 y {MAX_CONTENT_LENGTH} caracteres"}
        ), 400
    content = (content or "").strip()

    # `is_sensitive` es opcional (ADR-030): lo que el autor declara. Con
    # `isinstance(..., bool)` y no truthiness -- "false" (texto) es verdadero en
    # Python y marcaría como sensible algo que quien escribe no marcó.
    is_sensitive = data.get("is_sensitive", False)
    if not isinstance(is_sensitive, bool):
        return jsonify({"msg": "`is_sensitive` debe ser true o false"}), 400

    prepared = []
    if files:
        # Antes de procesar nada: decodificar imágenes cuesta CPU, así que se
        # cuenta cada petición con imágenes (el acierto es el abuso).
        try:
            rate_limit_guard.enforce(
                policy.IMAGE_UPLOAD, f"user:{author_id}", _rate_limit_repository
            )
        except RateLimitExceededError as error:
            return rate_limited_response(error)

        prepared, error_response = process_files(files, "post")
        if error_response:
            return error_response

    post = create_post(
        author_id, content, _post_repository, _user_repository,
        _follow_repository, _mention_repository, _notification_repository,
        _restriction_repository, is_sensitive,
        prepared_images=prepared,
        media_repository=_media_repository,
        media_storage=current_app.extensions["media_storage"],
    )
    return jsonify({"post": post}), 201


@posts_bp.route("/posts", methods=["GET"])
@jwt_required()
def list_all():
    # Auth requerida por consistencia con el resto del feed hoy -- AppShell
    # (donde vive /feed en el Frontend) solo es alcanzable dentro de
    # ProtectedRoute. No existe todavía ningún concepto de "feed público".
    # viewer_id (ADR-005): quién pregunta, para resolver `liked_by_me` por
    # post -- mismo JWT que ya identifica al autor en create().
    viewer_id = get_jwt_identity()
    posts = list_posts(
        _post_repository, _like_repository, _comment_repository, _follow_repository,
        _mention_repository, _muted_keyword_repository, viewer_id, DEFAULT_LIMIT,
    )
    return jsonify({"posts": posts}), 200


@posts_bp.route("/posts/<uuid:post_id>", methods=["PATCH"])
@jwt_required()
def update(post_id):
    # Solo el autor puede editar su propia publicación -- la pertenencia se
    # resuelve contra el JWT, nunca contra nada que venga del cliente
    # (ADR-021-content-editing.md, mismo criterio que DELETE /api/posts/<id>).
    author_id = get_jwt_identity()

    data = request.get_json(silent=True)
    if not data:
        return jsonify({"msg": "No se enviaron datos"}), 400

    # Whitelist explícita: solo `content` se lee del body -- nunca
    # `author_id`/`id`/`created_at`/`edited_at` (mismo principio
    # anti mass-assignment que POST /api/posts y PATCH /api/users/me).
    # `content` es obligatorio, no opcional como los campos de
    # PATCH /api/users/me (ADR-003): es el único campo editable, así que un
    # PATCH sin él no tiene nada que hacer.
    content = data.get("content")
    if not is_valid_content(content):
        return jsonify(
            {"msg": f"El contenido debe tener entre 1 y {MAX_CONTENT_LENGTH} caracteres"}
        ), 400

    try:
        post = update_post(
            str(post_id), author_id, content.strip(),
            _post_repository, _like_repository, _comment_repository,
            _user_repository, _follow_repository, _mention_repository,
            _notification_repository, _muted_keyword_repository, _restriction_repository,
        )
    except PostNotFoundError:
        # Mismo mensaje/código tanto si el id no existe como si existe pero es
        # de otro autor -- no revela cuál de los dos ocurrió.
        return jsonify({"msg": "Publicación no encontrada"}), 404

    return jsonify({"post": post}), 200


@posts_bp.route("/posts/<uuid:post_id>", methods=["DELETE"])
@jwt_required()
def delete(post_id):
    # Solo el autor puede borrar su propia publicación -- la pertenencia se
    # resuelve contra el JWT, nunca contra nada que venga del cliente
    # (ADR-019-post-deletion.md, mismo criterio que DELETE /api/messages/<id>).
    #
    # `<uuid:post_id>`: el conversor `uuid` de Flask/Werkzeug ya devuelve 404
    # para cualquier segmento que no sea un UUID válido, sin validarlo a mano
    # (mismo criterio que like_routes.py/comment_routes.py).
    author_id = get_jwt_identity()

    try:
        result = delete_post(
            str(post_id), author_id, _post_repository,
            _media_repository, current_app.extensions["media_storage"],
        )
    except PostNotFoundError:
        # Mismo mensaje/código tanto si el id no existe como si existe pero
        # es de otro autor -- no revela cuál de los dos ocurrió (mismo
        # criterio que DELETE /api/messages/<id>, ADR-014).
        return jsonify({"msg": "Publicación no encontrada"}), 404

    return jsonify(result), 200
