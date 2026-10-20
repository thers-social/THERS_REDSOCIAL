# Casos de uso de las llamadas 1 a 1. La identidad de quien actúa viene siempre del JWT (la route);
# el audio y el video viajan por LiveKit, aquí solo se coordina quién llama a quién y en qué estado.

from flask import current_app

from app.application.media.media_url import media_url
from app.domain.auth.exceptions import UserNotFoundError
from app.domain.calls import status as call_status
from app.domain.calls.exceptions import (
    CallNotAllowedError,
    CallNotFoundError,
    CallsDisabledError,
    CallStateError,
    CannotCallSelfError,
    UserBusyError,
)
from app.domain.follows.follow_status import ACCEPTED
from app.domain.privacy.audience import is_allowed
from app.domain.restrictions.exceptions import AccountBlockedError
from app.domain.restrictions.kinds import BLOCK
from app.extensions import db
from app.infrastructure.calls.livekit_token import build_room_token


def _config():
    cfg = current_app.config
    if not (
        cfg.get("CALLS_ENABLED")
        and cfg.get("LIVEKIT_URL")
        and cfg.get("LIVEKIT_API_KEY")
        and cfg.get("LIVEKIT_API_SECRET")
    ):
        raise CallsDisabledError()
    return cfg


def _ring_seconds():
    return current_app.config.get("CALL_RING_SECONDS") or 30


def _person(user):
    return {
        "id": str(user.id),
        "name": user.name,
        "username": user.username,
        "avatar_url": media_url(user.avatar_path),
    }


def _public(call, user_repository, viewer_id):
    return {
        "id": str(call.id),
        "kind": call.kind,
        "status": call.status,
        "direction": "outgoing" if str(call.caller_id) == str(viewer_id) else "incoming",
        "caller": _person(user_repository.find_by_id(call.caller_id)),
        "callee": _person(user_repository.find_by_id(call.callee_id)),
        "created_at": call.created_at.isoformat(),
        "answered_at": call.answered_at.isoformat() if call.answered_at else None,
        "ended_at": call.ended_at.isoformat() if call.ended_at else None,
    }


def _access(call, user_repository, user_id):
    """El token de LiveKit y la URL para entrar a la sala de esta llamada."""
    cfg = _config()
    me = user_repository.find_by_id(user_id)
    token = build_room_token(
        cfg["LIVEKIT_API_KEY"], cfg["LIVEKIT_API_SECRET"], call.room_name, str(user_id), me.name
    )
    return {"token": token, "url": cfg["LIVEKIT_URL"], "room": call.room_name}


def _load_for(call_id, user_id, call_repository):
    call = call_repository.find_by_id(call_id)
    # Mismo 404 si no existe o si la persona no participa: no revela llamadas ajenas.
    if call is None or str(user_id) not in (str(call.caller_id), str(call.callee_id)):
        raise CallNotFoundError()
    return call


def _fresh(call):
    # El estado cambia con UPDATE condicionales (sin pasar por la instancia): se vuelve a leer.
    db.session.refresh(call)
    return call


def start_call(
    caller_id, callee_id, kind, user_repository, call_repository, follow_repository,
    restriction_repository,
):
    _config()
    if caller_id == callee_id:
        raise CannotCallSelfError()

    callee = user_repository.find_by_id(callee_id)
    if callee is None:
        raise UserNotFoundError()

    # Mismas reglas que un mensaje directo: bloqueos (ADR-029) y `who_can_message` (ADR-024).
    if restriction_repository.get_kind(callee_id, caller_id) == BLOCK:
        raise UserNotFoundError()
    if restriction_repository.get_kind(caller_id, callee_id) == BLOCK:
        raise AccountBlockedError()
    caller_follows_callee = (
        follow_repository.follow_statuses(caller_id, [callee.id]).get(callee.id) == ACCEPTED
    )
    if not is_allowed(callee.who_can_message, caller_follows_callee):
        raise CallNotAllowedError()

    call_repository.expire_stale([caller_id, callee_id], _ring_seconds())
    if call_repository.open_call_of(caller_id) or call_repository.open_call_of(callee_id):
        raise UserBusyError()

    call = call_repository.create(caller_id, callee_id, kind)
    return {
        "call": _public(call, user_repository, caller_id),
        "access": _access(call, user_repository, caller_id),
    }


def get_call(call_id, user_id, user_repository, call_repository):
    call = _load_for(call_id, user_id, call_repository)
    call_repository.expire_stale([call.caller_id, call.callee_id], _ring_seconds())
    return _public(_fresh(call), user_repository, user_id)


def incoming_call(user_id, user_repository, call_repository):
    """La llamada que está sonando para esta persona, o None."""
    call_repository.expire_stale([user_id], _ring_seconds())
    call = call_repository.ringing_for(user_id)
    return _public(call, user_repository, user_id) if call else None


def accept_call(call_id, user_id, user_repository, call_repository):
    _config()
    call = _load_for(call_id, user_id, call_repository)
    if str(call.callee_id) != str(user_id):
        raise CallStateError()
    call_repository.expire_stale([call.caller_id, call.callee_id], _ring_seconds())
    if not call_repository.transition(call.id, (call_status.RINGING,), call_status.ACTIVE):
        raise CallStateError()
    call = _fresh(call)
    return {
        "call": _public(call, user_repository, user_id),
        "access": _access(call, user_repository, user_id),
    }


def decline_call(call_id, user_id, user_repository, call_repository):
    call = _load_for(call_id, user_id, call_repository)
    if str(call.callee_id) != str(user_id):
        raise CallStateError()
    call_repository.transition(call.id, (call_status.RINGING,), call_status.DECLINED)
    return _public(_fresh(call), user_repository, user_id)


def cancel_call(call_id, user_id, user_repository, call_repository):
    call = _load_for(call_id, user_id, call_repository)
    if str(call.caller_id) != str(user_id):
        raise CallStateError()
    call_repository.transition(call.id, (call_status.RINGING,), call_status.CANCELLED)
    return _public(_fresh(call), user_repository, user_id)


def end_call(call_id, user_id, user_repository, call_repository):
    """Colgar es idempotente: si ya terminó (o la otra persona colgó primero) responde con el estado
    actual. Si todavía suena y cuelga quien llamó, equivale a cancelar."""
    call = _load_for(call_id, user_id, call_repository)
    if call.status == call_status.RINGING and str(call.caller_id) == str(user_id):
        call_repository.transition(call.id, (call_status.RINGING,), call_status.CANCELLED)
    else:
        call_repository.transition(call.id, (call_status.ACTIVE,), call_status.ENDED)
    return _public(_fresh(call), user_repository, user_id)
