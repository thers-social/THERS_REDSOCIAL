# POST y DELETE /api/posts/<post_id>/like (ADR-005-likes-minimal-model.md).
# Blueprint separado de posts_bp -- "likes" es su propia entidad (mismo
# criterio que separa auth_bp de users_bp), aunque su URL anide bajo
# /posts/<id> por ser un sub-recurso natural de un post.
#
# `<uuid:post_id>`: el conversor `uuid` de Flask/Werkzeug ya devuelve 404
# (ninguna ruta matchea) para cualquier segmento que no sea un UUID válido,
# sin necesidad de validarlo a mano (ADR-005 §Contrato API).

from flask import Blueprint, jsonify
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.application.likes.like_post_use_case import like_post
from app.application.likes.unlike_post_use_case import unlike_post
from app.domain.posts.exceptions import PostNotFoundError
from app.interfaces.profile_gate import profile_completed_required
from app.infrastructure.persistence.repositories.follow_repository import (
    SQLAlchemyFollowRepository,
)
from app.infrastructure.persistence.repositories.like_repository import (
    SQLAlchemyLikeRepository,
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

likes_bp = Blueprint("likes", __name__)

_post_repository = SQLAlchemyPostRepository()
_like_repository = SQLAlchemyLikeRepository()
_notification_repository = SQLAlchemyNotificationRepository()
# ADR-022-private-accounts.md: no se le puede dar like a lo que no se puede
# ver, así que estos endpoints necesitan resolver la relación de seguimiento.
_follow_repository = SQLAlchemyFollowRepository()
# ADR-029-blocked-and-restricted-accounts.md: tampoco se da like a quien bloqueó
# o fue bloqueado.
_restriction_repository = SQLAlchemyRestrictionRepository()
_close_friend_repository = SQLAlchemyCloseFriendRepository()


@likes_bp.route("/posts/<uuid:post_id>/like", methods=["POST"])
@jwt_required()
@profile_completed_required
def like(post_id):
    # Identidad exclusivamente del JWT -- nunca del body (mismo principio
    # que el resto de endpoints protegidos).
    user_id = get_jwt_identity()

    try:
        result = like_post(
            post_id, user_id, _post_repository, _like_repository,
            _notification_repository, _follow_repository, _restriction_repository,
            close_friend_repository=_close_friend_repository,
        )
    except PostNotFoundError:
        return jsonify({"msg": "Post no encontrado"}), 404

    # 200, no 201: idempotente -- un segundo POST no crea un recurso nuevo,
    # devuelve el mismo estado (ADR-005 §Decisión, Opción A).
    return jsonify(result), 200


@likes_bp.route("/posts/<uuid:post_id>/like", methods=["DELETE"])
@jwt_required()
def unlike(post_id):
    user_id = get_jwt_identity()

    try:
        result = unlike_post(
            post_id, user_id, _post_repository, _like_repository, _follow_repository,
            _restriction_repository, close_friend_repository=_close_friend_repository,
        )
    except PostNotFoundError:
        return jsonify({"msg": "Post no encontrado"}), 404

    return jsonify(result), 200
