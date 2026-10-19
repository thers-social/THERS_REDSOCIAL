# POST y GET /api/posts/<post_id>/comments (ADR-006-comments-minimal-model.md)
# DELETE /api/comments/<comment_id> (ADR-020-comment-deletion.md) y
# PATCH /api/comments/<comment_id> (ADR-021-content-editing.md).
# Blueprint separado de posts_bp -- "comments" es su propia entidad (mismo
# criterio que separa auth_bp de users_bp, y que like_routes.py de posts_bp),
# aunque su URL anide bajo /posts/<id> por ser un sub-recurso natural de un
# post.
#
# `<uuid:post_id>`: el conversor `uuid` de Flask/Werkzeug ya devuelve 404
# (ninguna ruta matchea) para cualquier segmento que no sea un UUID válido,
# sin necesidad de validarlo a mano (mismo criterio que like_routes.py).

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.application.comments.create_comment_use_case import create_comment
from app.application.comments.delete_comment_use_case import delete_comment
from app.application.comments.list_comments_use_case import (
    DEFAULT_LIMIT,
    list_comments,
)
from app.application.comments.update_comment_use_case import update_comment
from app.domain.comments.exceptions import CommentNotFoundError
from app.domain.comments.validators import MAX_CONTENT_LENGTH, is_valid_content
from app.domain.posts.exceptions import PostNotFoundError
from app.interfaces.profile_gate import profile_completed_required
from app.infrastructure.persistence.repositories.comment_repository import (
    SQLAlchemyCommentRepository,
)
from app.infrastructure.persistence.repositories.follow_repository import (
    SQLAlchemyFollowRepository,
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
from app.infrastructure.persistence.repositories.post_repository import (
    SQLAlchemyPostRepository,
)
from app.infrastructure.persistence.repositories.close_friend_repository import (
    SQLAlchemyCloseFriendRepository,
)
from app.infrastructure.persistence.repositories.restriction_repository import (
    SQLAlchemyRestrictionRepository,
)
from app.infrastructure.persistence.repositories.user_repository import (
    SQLAlchemyUserRepository,
)

comments_bp = Blueprint("comments", __name__)

_post_repository = SQLAlchemyPostRepository()
_comment_repository = SQLAlchemyCommentRepository()
_notification_repository = SQLAlchemyNotificationRepository()
# ADR-022-private-accounts.md: el hilo de una cuenta privada no se lee ni se
# comenta desde fuera.
_follow_repository = SQLAlchemyFollowRepository()
# ADR-023-mentions.md / ADR-024-content-filters-and-privacy-preferences.md.
_user_repository = SQLAlchemyUserRepository()
_mention_repository = SQLAlchemyMentionRepository()
_muted_keyword_repository = SQLAlchemyMutedKeywordRepository()
# ADR-029-blocked-and-restricted-accounts.md: bloqueos y restricciones.
_restriction_repository = SQLAlchemyRestrictionRepository()
_close_friend_repository = SQLAlchemyCloseFriendRepository()


@comments_bp.route("/posts/<uuid:post_id>/comments", methods=["POST"])
@jwt_required()
@profile_completed_required
def create(post_id):
    # Identidad exclusivamente del JWT -- nunca del body (mismo principio
    # que el resto de endpoints protegidos).
    author_id = get_jwt_identity()

    data = request.get_json(silent=True)
    if not data:
        return jsonify({"msg": "No se enviaron datos"}), 400

    # Whitelist explícita: solo `content` se lee del body -- nunca
    # `post_id`/`author_id`/`id` (post_id viene de la URL, no del body;
    # mismo principio anti mass-assignment que POST /api/posts).
    content = data.get("content")
    if not is_valid_content(content):
        return jsonify(
            {"msg": f"El contenido debe tener entre 1 y {MAX_CONTENT_LENGTH} caracteres"}
        ), 400

    try:
        comment = create_comment(
            post_id,
            author_id,
            content.strip(),
            _post_repository,
            _comment_repository,
            _notification_repository,
            _follow_repository,
            _user_repository,
            _mention_repository,
            _restriction_repository,
            close_friend_repository=_close_friend_repository,
        )
    except PostNotFoundError:
        return jsonify({"msg": "Post no encontrado"}), 404

    return jsonify({"comment": comment}), 201


@comments_bp.route("/posts/<uuid:post_id>/comments", methods=["GET"])
@jwt_required()
def list_all(post_id):
    # viewer_id: el hilo de una cuenta privada no se lee desde fuera
    # (ADR-022-private-accounts.md).
    viewer_id = get_jwt_identity()

    try:
        comments = list_comments(
            post_id, viewer_id, _post_repository, _comment_repository,
            _follow_repository, _mention_repository, _muted_keyword_repository,
            _restriction_repository, DEFAULT_LIMIT,
            close_friend_repository=_close_friend_repository,
        )
    except PostNotFoundError:
        return jsonify({"msg": "Post no encontrado"}), 404

    return jsonify({"comments": comments}), 200


@comments_bp.route("/comments/<uuid:comment_id>", methods=["PATCH"])
@jwt_required()
def update(comment_id):
    # Ruta plana, igual que DELETE: editar depende de quién escribió el
    # comentario, no de en qué publicación está (ADR-021-content-editing.md).
    author_id = get_jwt_identity()

    data = request.get_json(silent=True)
    if not data:
        return jsonify({"msg": "No se enviaron datos"}), 400

    # Whitelist explícita: solo `content` -- nunca `post_id`/`author_id`/`id`.
    # Editar un comentario no puede moverlo a otra publicación.
    content = data.get("content")
    if not is_valid_content(content):
        return jsonify(
            {"msg": f"El contenido debe tener entre 1 y {MAX_CONTENT_LENGTH} caracteres"}
        ), 400

    try:
        comment = update_comment(
            str(comment_id), author_id, content.strip(), _comment_repository,
            _user_repository, _follow_repository, _mention_repository,
            _notification_repository, _restriction_repository,
        )
    except CommentNotFoundError:
        return jsonify({"msg": "Comentario no encontrado"}), 404

    return jsonify({"comment": comment}), 200


@comments_bp.route("/comments/<uuid:comment_id>", methods=["DELETE"])
@jwt_required()
def delete(comment_id):
    # No anida bajo /posts/<id>/comments -- borrar depende de quién escribió
    # el comentario, no de en qué post está (mismo criterio que
    # DELETE /api/messages/<id>, ADR-014). Solo el autor puede borrar el
    # suyo; la identidad sale exclusivamente del JWT.
    author_id = get_jwt_identity()

    try:
        result = delete_comment(str(comment_id), author_id, _comment_repository)
    except CommentNotFoundError:
        # Mismo mensaje/código tanto si el id no existe como si existe pero
        # es de otro autor -- no revela cuál de los dos ocurrió.
        return jsonify({"msg": "Comentario no encontrado"}), 404

    return jsonify(result), 200
