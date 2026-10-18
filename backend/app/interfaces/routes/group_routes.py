# Chats grupales (ADR-048): /api/groups. Identidad siempre del JWT. Un grupo del que no se es miembro
# responde 404 igual que uno inexistente.

import uuid

from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.application.groups.group_message_use_cases import list_group_thread, send_group_message
from app.application.groups.group_use_cases import (
    add_members,
    create_group,
    get_group,
    leave_group,
    list_groups,
    promote_member,
    remove_member,
    rename_group,
)
from app.domain.auth.exceptions import UserNotFoundError
from app.domain.groups.exceptions import (
    CannotAddMemberError,
    GroupFullError,
    GroupNotFoundError,
    InvalidGroupError,
    NotGroupAdminError,
)
from app.domain.groups.rules import MAX_MEMBERS, MAX_NAME_LENGTH
from app.domain.messages.exceptions import SharedPlaceNotFoundError, SharedPostNotFoundError
from app.application.messages.list_thread_use_case import DEFAULT_LIMIT
from app.infrastructure.persistence.repositories.audio_attachment_repository import (
    SQLAlchemyAudioAttachmentRepository,
)
from app.infrastructure.persistence.repositories.follow_repository import (
    SQLAlchemyFollowRepository,
)
from app.infrastructure.persistence.repositories.group_repository import SQLAlchemyGroupRepository
from app.infrastructure.persistence.repositories.media_attachment_repository import (
    SQLAlchemyMediaAttachmentRepository,
)
from app.infrastructure.persistence.repositories.message_repository import (
    SQLAlchemyMessageRepository,
)
from app.infrastructure.persistence.repositories.restriction_repository import (
    SQLAlchemyRestrictionRepository,
)
from app.infrastructure.persistence.repositories.user_repository import SQLAlchemyUserRepository
from app.infrastructure.persistence.repositories.video_attachment_repository import (
    SQLAlchemyVideoAttachmentRepository,
)
from app.interfaces.profile_gate import profile_completed_required
from app.interfaces.routes.message_routes import _parse_thread_query, read_message_payload

groups_bp = Blueprint("groups", __name__)

_group_repository = SQLAlchemyGroupRepository()
_user_repository = SQLAlchemyUserRepository()
_message_repository = SQLAlchemyMessageRepository()
_follow_repository = SQLAlchemyFollowRepository()
_restriction_repository = SQLAlchemyRestrictionRepository()
_media_repository = SQLAlchemyMediaAttachmentRepository()
_audio_repository = SQLAlchemyAudioAttachmentRepository()
_video_repository = SQLAlchemyVideoAttachmentRepository()


def _uuid_list(value):
    """Lista de UUID (str) válidos, o None si el valor no lo es."""
    if not isinstance(value, list) or len(value) > MAX_MEMBERS:
        return None
    out = []
    for item in value:
        try:
            out.append(str(uuid.UUID(item)))
        except (ValueError, TypeError, AttributeError):
            return None
    return out


def _not_found():
    return jsonify({"msg": "Grupo no encontrado"}), 404


def _forbidden():
    return jsonify({"msg": "Solo los administradores pueden hacer esto"}), 403


def _full():
    return jsonify({"msg": f"Un grupo admite como máximo {MAX_MEMBERS} personas"}), 409


def _cannot_add():
    return jsonify({"msg": "No puedes añadir a alguna de esas personas al grupo"}), 403


def _invalid():
    return jsonify(
        {"msg": f"Pon un nombre de hasta {MAX_NAME_LENGTH} caracteres y al menos una persona más"}
    ), 400


@groups_bp.route("/groups", methods=["POST"])
@jwt_required()
@profile_completed_required
def create():
    user_id = get_jwt_identity()
    data = request.get_json(silent=True) or {}
    member_ids = _uuid_list(data.get("member_ids"))
    if member_ids is None:
        return jsonify({"msg": "member_ids debe ser una lista de identificadores válidos"}), 400
    try:
        group = create_group(
            user_id, data.get("name"), member_ids, _user_repository, _group_repository,
            _follow_repository, _restriction_repository,
        )
    except InvalidGroupError:
        return _invalid()
    except GroupFullError:
        return _full()
    except CannotAddMemberError:
        return _cannot_add()
    return jsonify({"group": group}), 201


@groups_bp.route("/groups", methods=["GET"])
@jwt_required()
def index():
    return jsonify({"groups": list_groups(get_jwt_identity(), _group_repository)}), 200


@groups_bp.route("/groups/<uuid:group_id>", methods=["GET"])
@jwt_required()
def detail(group_id):
    try:
        return jsonify({"group": get_group(str(group_id), get_jwt_identity(), _group_repository)}), 200
    except GroupNotFoundError:
        return _not_found()


@groups_bp.route("/groups/<uuid:group_id>", methods=["PATCH"])
@jwt_required()
def rename(group_id):
    data = request.get_json(silent=True) or {}
    try:
        group = rename_group(str(group_id), get_jwt_identity(), data.get("name"), _group_repository)
    except GroupNotFoundError:
        return _not_found()
    except NotGroupAdminError:
        return _forbidden()
    except InvalidGroupError:
        return _invalid()
    return jsonify({"group": group}), 200


@groups_bp.route("/groups/<uuid:group_id>/members", methods=["POST"])
@jwt_required()
def add(group_id):
    data = request.get_json(silent=True) or {}
    user_ids = _uuid_list(data.get("user_ids"))
    if user_ids is None:
        return jsonify({"msg": "user_ids debe ser una lista de identificadores válidos"}), 400
    try:
        group = add_members(
            str(group_id), get_jwt_identity(), user_ids, _user_repository, _group_repository,
            _follow_repository, _restriction_repository,
        )
    except GroupNotFoundError:
        return _not_found()
    except NotGroupAdminError:
        return _forbidden()
    except InvalidGroupError:
        return jsonify({"msg": "Esas personas ya están en el grupo"}), 400
    except GroupFullError:
        return _full()
    except CannotAddMemberError:
        return _cannot_add()
    return jsonify({"group": group}), 200


@groups_bp.route("/groups/<uuid:group_id>/members/<uuid:target_id>", methods=["PATCH"])
@jwt_required()
def promote(group_id, target_id):
    data = request.get_json(silent=True) or {}
    if data.get("role") != "admin":
        return jsonify({"msg": "Solo se puede nombrar administrador (role: admin)"}), 400
    try:
        group = promote_member(str(group_id), get_jwt_identity(), str(target_id), _group_repository)
    except GroupNotFoundError:
        return _not_found()
    except NotGroupAdminError:
        return _forbidden()
    except UserNotFoundError:
        return jsonify({"msg": "Esa persona no está en el grupo"}), 404
    return jsonify({"group": group}), 200


@groups_bp.route("/groups/<uuid:group_id>/members/<uuid:target_id>", methods=["DELETE"])
@jwt_required()
def remove(group_id, target_id):
    try:
        group = remove_member(str(group_id), get_jwt_identity(), str(target_id), _group_repository)
    except GroupNotFoundError:
        return _not_found()
    except NotGroupAdminError:
        return _forbidden()
    except UserNotFoundError:
        return jsonify({"msg": "Esa persona no está en el grupo o es administradora"}), 404
    return jsonify({"group": group}), 200


@groups_bp.route("/groups/<uuid:group_id>/leave", methods=["POST"])
@jwt_required()
def leave(group_id):
    try:
        result = leave_group(
            str(group_id), get_jwt_identity(), _group_repository,
            media_storage=current_app.extensions["media_storage"],
        )
        return jsonify(result), 200
    except GroupNotFoundError:
        return _not_found()


@groups_bp.route("/groups/<uuid:group_id>/messages", methods=["GET"])
@jwt_required()
def thread(group_id):
    limit, before, after, error = _parse_thread_query()
    if error:
        return error
    try:
        messages, has_more = list_group_thread(
            str(group_id), get_jwt_identity(), _group_repository, _message_repository,
            _restriction_repository, limit, before=before, after=after,
        )
    except GroupNotFoundError:
        return _not_found()
    return jsonify({"messages": messages, "has_more": has_more}), 200


@groups_bp.route("/groups/<uuid:group_id>/messages", methods=["POST"])
@jwt_required()
@profile_completed_required
def send(group_id):
    sender_id = get_jwt_identity()
    # Un no miembro no debe poder ni probar la subida de archivos: se comprueba antes de leer el cuerpo.
    if _group_repository.membership(str(group_id), sender_id) is None:
        return _not_found()

    payload = read_message_payload(sender_id)
    if not isinstance(payload, dict):
        return payload

    try:
        message, created = send_group_message(
            str(group_id), sender_id, payload["content"], _group_repository, _message_repository,
            client_id=payload["client_id"],
            prepared_images=payload["prepared"],
            media_repository=_media_repository,
            media_storage=current_app.extensions["media_storage"],
            place_id=payload["place_id"],
            prepared_audio=payload["prepared_voice"],
            audio_repository=_audio_repository,
            prepared_video=payload["prepared_video"],
            video_repository=_video_repository,
            post_id=payload["post_id"],
        )
    except GroupNotFoundError:
        return _not_found()
    except SharedPostNotFoundError:
        return jsonify({"msg": "Publicación no encontrada"}), 404
    except SharedPlaceNotFoundError:
        return jsonify({"msg": "Lugar no encontrado"}), 404

    return jsonify({"message": message}), 201 if created else 200
