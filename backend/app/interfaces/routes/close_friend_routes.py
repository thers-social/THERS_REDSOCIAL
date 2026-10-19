# Mejores amigos (ADR-054):
#   GET    /api/close-friends               mi lista
#   POST   /api/close-friends               añadir a alguien ({user_id})
#   DELETE /api/close-friends/<user_id>     quitar a alguien
# La lista es PRIVADA: solo la ve quien la hace, y la identidad sale del JWT, nunca del cuerpo.
# Comparte el interruptor `STORIES_ENABLED` con las historias, que es lo único para lo que sirve.

import uuid

from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.application.close_friends import close_friend_use_cases as close_friends
from app.domain.close_friends.rules import (
    MAX_CLOSE_FRIENDS,
    CloseFriendsLimitError,
    CloseFriendTargetNotFoundError,
)
from app.infrastructure.persistence.repositories.close_friend_repository import (
    SQLAlchemyCloseFriendRepository,
)
from app.interfaces.profile_gate import profile_completed_required

close_friends_bp = Blueprint("close_friends", __name__)

_repository = SQLAlchemyCloseFriendRepository()


@close_friends_bp.before_request
def _module_disabled():
    # Apagado, nada de esto existe: mismo 404 que una URL inexistente, antes de autenticar.
    if not current_app.config.get("STORIES_ENABLED", False):
        return jsonify({"msg": "Recurso no encontrado"}), 404
    return None


@close_friends_bp.route("/close-friends", methods=["GET"])
@jwt_required()
def list_friends():
    return jsonify(close_friends.list_close_friends(get_jwt_identity(), _repository)), 200


@close_friends_bp.route("/close-friends", methods=["POST"])
@jwt_required()
@profile_completed_required
def add_friend():
    data = request.get_json(silent=True) or {}
    user_id = data.get("user_id")
    if not isinstance(user_id, str) or not user_id.strip():
        return jsonify({"msg": "Indica la persona con `user_id`"}), 400
    try:
        # Un `user_id` que no es un UUID no existe: se trata como cualquier persona inexistente.
        friend_id = uuid.UUID(user_id.strip())
    except ValueError:
        return jsonify({"msg": "Persona no encontrada"}), 404
    try:
        result = close_friends.add_close_friend(get_jwt_identity(), friend_id, _repository)
    except CloseFriendTargetNotFoundError:
        return jsonify({"msg": "Persona no encontrada"}), 404
    except CloseFriendsLimitError:
        return jsonify(
            {"msg": f"Tu lista puede tener como máximo {MAX_CLOSE_FRIENDS} personas"}
        ), 409
    return jsonify(result), 201 if result["added"] else 200


@close_friends_bp.route("/close-friends/<uuid:user_id>", methods=["DELETE"])
@jwt_required()
def remove_friend(user_id):
    return jsonify(close_friends.remove_close_friend(get_jwt_identity(), user_id, _repository)), 200
