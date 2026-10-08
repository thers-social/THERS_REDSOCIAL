# POST/GET /api/users/<user_id>/messages y GET /api/conversations
# (ADR-013-messages-minimal-model.md). Blueprint separado de users_bp --
# "messages" es su propia entidad (mismo criterio que separa follows_bp de
# users_bp), aunque la URL de mandar/leer un hilo anide bajo /users/<id> por
# ser un sub-recurso natural de un usuario. `GET /api/conversations` no
# anida bajo ningún recurso -- siempre se lista desde la perspectiva del
# usuario autenticado, mismo criterio que `GET /api/notifications`.
#
# `<uuid:user_id>`: el conversor `uuid` de Flask/Werkzeug ya devuelve 404
# (ninguna ruta matchea) para cualquier segmento que no sea un UUID válido,
# sin necesidad de validarlo a mano (mismo criterio que follow_routes.py).

import re
from datetime import datetime

from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.application.rate_limiting import rate_limit_guard
from app.domain.media.attachments import MAX_MESSAGE_IMAGES
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
from app.interfaces.rate_limited_response import rate_limited_response

from app.application.messages.delete_message_use_case import delete_message
from app.application.messages.get_typing_status_use_case import get_typing_status
from app.application.messages.list_conversations_use_case import list_conversations
from app.application.messages.list_thread_use_case import DEFAULT_LIMIT, list_thread
from app.application.messages.send_message_use_case import send_message
from app.application.messages.send_typing_ping_use_case import send_typing_ping
from app.application.messages.update_message_use_case import update_message
from app.domain.auth.exceptions import UserNotFoundError
from app.domain.messages.exceptions import (
    CannotMessageSelfError,
    MessageNotFoundError,
    MessagesNotAllowedError,
)
from app.domain.messages.validators import (
    MAX_CONTENT_LENGTH,
    is_valid_content,
    is_valid_content_with_images,
)
from app.interfaces.profile_gate import profile_completed_required
from app.infrastructure.persistence.repositories.follow_repository import (
    SQLAlchemyFollowRepository,
)
from app.infrastructure.persistence.repositories.message_repository import (
    SQLAlchemyMessageRepository,
)
from app.domain.restrictions.exceptions import AccountBlockedError
from app.infrastructure.persistence.repositories.restriction_repository import (
    SQLAlchemyRestrictionRepository,
)
from app.infrastructure.persistence.repositories.user_repository import (
    SQLAlchemyUserRepository,
)
from app.infrastructure.realtime.typing_indicator_repository import (
    InMemoryTypingIndicatorRepository,
)

messages_bp = Blueprint("messages", __name__)

_CLIENT_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
MAX_PAGE_LIMIT = 100


def _parse_instant(raw):
    """Un instante ISO 8601 con zona horaria (el `created_at` de un mensaje), o None."""
    try:
        parsed = datetime.fromisoformat(raw)
    except (TypeError, ValueError):
        return None
    return parsed if parsed.tzinfo is not None else None


def _parse_thread_query():
    """`(limit, before, after, error_response)` desde la query string."""
    limit = DEFAULT_LIMIT
    raw_limit = request.args.get("limit")
    if raw_limit is not None:
        if not raw_limit.isdigit() or not 1 <= int(raw_limit) <= MAX_PAGE_LIMIT:
            return None, None, None, (
                jsonify({"msg": f"limit debe ser un entero entre 1 y {MAX_PAGE_LIMIT}"}), 400
            )
        limit = int(raw_limit)

    raw_before = request.args.get("before")
    raw_after = request.args.get("after")
    if raw_before is not None and raw_after is not None:
        return None, None, None, (
            jsonify({"msg": "Usa before o after, no los dos a la vez"}), 400
        )

    before = after = None
    if raw_before is not None:
        before = _parse_instant(raw_before)
        if before is None:
            return None, None, None, (
                jsonify({"msg": "before debe ser una fecha ISO 8601 con zona horaria"}), 400
            )
    if raw_after is not None:
        after = _parse_instant(raw_after)
        if after is None:
            return None, None, None, (
                jsonify({"msg": "after debe ser una fecha ISO 8601 con zona horaria"}), 400
            )
    return limit, before, after, None


_user_repository = SQLAlchemyUserRepository()
_message_repository = SQLAlchemyMessageRepository()
_typing_repository = InMemoryTypingIndicatorRepository()
# ADR-024-content-filters-and-privacy-preferences.md: `who_can_message` en
# 'followers' obliga a resolver la relación de seguimiento.
_follow_repository = SQLAlchemyFollowRepository()
# ADR-029-blocked-and-restricted-accounts.md: un bloqueo corta la mensajería.
_restriction_repository = SQLAlchemyRestrictionRepository()
# ADR-039: imagen adjunta y su límite de subidas.
_media_repository = SQLAlchemyMediaAttachmentRepository()
_rate_limit_repository = SQLAlchemyRateLimitRepository()


@messages_bp.route("/users/<uuid:user_id>/messages", methods=["POST"])
@jwt_required()
@profile_completed_required
def create(user_id):
    # Identidad exclusivamente del JWT -- nunca del body (mismo principio
    # que el resto de endpoints protegidos).
    sender_id = get_jwt_identity()

    # JSON (como siempre) o multipart con la imagen en el campo `images` (ADR-039).
    data, files = read_request_data()
    if not data and not files:
        return jsonify({"msg": "No se enviaron datos"}), 400
    data = data or {}

    if len(files) > MAX_MESSAGE_IMAGES:
        return too_many_images_response(MAX_MESSAGE_IMAGES)

    # Whitelist explícita: solo `content` se lee del body -- nunca
    # `sender_id`/`recipient_id`/`id` (recipient_id viene de la URL, no del
    # body; mismo principio anti mass-assignment que POST /api/posts).
    # Con imagen el texto puede ir vacío; sin ella sigue siendo obligatorio.
    content = data.get("content")
    content_ok = is_valid_content_with_images(content) if files else is_valid_content(content)
    if not content_ok:
        return jsonify(
            {"msg": f"El contenido debe tener entre 1 y {MAX_CONTENT_LENGTH} caracteres"}
        ), 400
    content = (content or "").strip()

    # ADR-035: identificador opcional que hace el envío idempotente. Se valida
    # estrictamente: es una clave de una tabla, no texto libre.
    client_id = data.get("client_id")
    if client_id is not None and not (
        isinstance(client_id, str) and _CLIENT_ID_RE.match(client_id)
    ):
        return jsonify(
            {"msg": "client_id debe tener entre 1 y 64 caracteres: letras, números, - o _"}
        ), 400

    prepared = []
    if files:
        # Decodificar imágenes cuesta CPU: se cuenta cada envío con imagen.
        try:
            rate_limit_guard.enforce(
                policy.IMAGE_UPLOAD, f"user:{sender_id}", _rate_limit_repository
            )
        except RateLimitExceededError as error:
            return rate_limited_response(error)

        prepared, error_response = process_files(files, "message")
        if error_response:
            return error_response

    try:
        message, created = send_message(
            sender_id, str(user_id), content, _user_repository,
            _message_repository, _follow_repository, _restriction_repository,
            client_id=client_id,
            prepared_images=prepared,
            media_repository=_media_repository,
            media_storage=current_app.extensions["media_storage"],
        )
    except CannotMessageSelfError:
        return jsonify({"msg": "No podés mandarte un mensaje a vos mismo"}), 400
    except UserNotFoundError:
        return jsonify({"msg": "Usuario no encontrado"}), 404
    except AccountBlockedError:
        return jsonify({"msg": "Tienes bloqueada a esta cuenta. Desbloquéala para escribirle."}), 409
    except MessagesNotAllowedError:
        # 403 y no 404: quien escribe ya sabía que esa cuenta existe, así que
        # ocultárselo no protegería nada y solo lo haría reintentar
        # (ADR-024 §Seguridad, a diferencia del 404 de una cuenta privada).
        return jsonify({"msg": "Esta persona no acepta mensajes tuyos"}), 403

    # 201 si es nuevo; 200 si el `client_id` ya existía (reintento idempotente).
    return jsonify({"message": message}), 201 if created else 200


@messages_bp.route("/users/<uuid:user_id>/messages", methods=["GET"])
@jwt_required()
def thread(user_id):
    current_user_id = get_jwt_identity()

    # ADR-035: paginación y recuperación. Sin parámetros, la misma respuesta de
    # siempre (los DEFAULT_LIMIT más recientes) más `has_more`.
    limit, before, after, error = _parse_thread_query()
    if error:
        return error

    try:
        messages, has_more = list_thread(
            current_user_id, str(user_id), _user_repository, _message_repository,
            _restriction_repository, limit, before=before, after=after,
        )
    except UserNotFoundError:
        return jsonify({"msg": "Usuario no encontrado"}), 404

    return jsonify({"messages": messages, "has_more": has_more}), 200


@messages_bp.route("/conversations", methods=["GET"])
@jwt_required()
def conversations():
    # Identidad exclusivamente del JWT -- nunca de query string. Un usuario
    # solo puede listar sus propias conversaciones, nunca las de otro
    # (mismo principio que GET /api/notifications).
    user_id = get_jwt_identity()

    result = list_conversations(user_id, _message_repository, _restriction_repository)
    return jsonify({"conversations": result}), 200


@messages_bp.route("/messages/<uuid:message_id>", methods=["PATCH"])
@jwt_required()
def update(message_id):
    # Ruta plana, igual que DELETE: editar depende de quién mandó el mensaje,
    # no de con quién es la conversación (ADR-021-content-editing.md). Solo
    # quien lo mandó puede editarlo -- nunca quien lo recibió.
    sender_id = get_jwt_identity()

    data = request.get_json(silent=True)
    if not data:
        return jsonify({"msg": "No se enviaron datos"}), 400

    # Whitelist explícita: solo `content` -- nunca `sender_id`/`recipient_id`/
    # `id`/`read_at`. Editar un mensaje no puede redirigirlo a otra persona ni
    # cambiar si fue leído.
    content = data.get("content")
    if not is_valid_content(content):
        return jsonify(
            {"msg": f"El contenido debe tener entre 1 y {MAX_CONTENT_LENGTH} caracteres"}
        ), 400

    try:
        message = update_message(
            str(message_id), sender_id, content.strip(), _message_repository
        )
    except MessageNotFoundError:
        return jsonify({"msg": "Mensaje no encontrado"}), 404

    return jsonify({"message": message}), 200


@messages_bp.route("/messages/<uuid:message_id>", methods=["DELETE"])
@jwt_required()
def delete(message_id):
    # No anida bajo /users/<id>/messages -- borrar depende de quién mandó
    # el mensaje, no de con quién es la conversación (ADR-014-messages-ux-improvements.md).
    sender_id = get_jwt_identity()

    try:
        result = delete_message(
            str(message_id), sender_id, _message_repository,
            _media_repository, current_app.extensions["media_storage"],
        )
    except MessageNotFoundError:
        # Mismo mensaje/código tanto si el id no existe como si existe pero
        # es de otro usuario -- no revela cuál de los dos ocurrió (mismo
        # criterio que PATCH /api/notifications/<id>/read).
        return jsonify({"msg": "Mensaje no encontrado"}), 404

    return jsonify(result), 200


@messages_bp.route("/users/<uuid:user_id>/typing", methods=["POST"])
@jwt_required()
def typing_ping(user_id):
    sender_id = get_jwt_identity()

    try:
        send_typing_ping(
            sender_id, str(user_id), _user_repository, _typing_repository,
            _restriction_repository,
        )
    except UserNotFoundError:
        return jsonify({"msg": "Usuario no encontrado"}), 404

    return "", 204


@messages_bp.route("/users/<uuid:user_id>/typing", methods=["GET"])
@jwt_required()
def typing_status(user_id):
    current_user_id = get_jwt_identity()

    result = get_typing_status(
        current_user_id, str(user_id), _typing_repository, _restriction_repository
    )
    return jsonify(result), 200
