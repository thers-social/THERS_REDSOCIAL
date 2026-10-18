# Casos de uso de las acciones de Tero con confirmación (ADR-041 §6.2, fase 6).
#
# `propose` solo GUARDA una propuesta y devuelve su tarjeta: no ejecuta nada. `confirm` es el único
# camino que ejecuta, y solo tras revalidar dueño, estado y vencimiento. La identidad es SIEMPRE la
# del JWT (`user_id`), nunca un dato de la propuesta ni del cuerpo de la petición.

import logging
from datetime import datetime, timedelta, timezone
from uuid import UUID

from app.application.auth.update_profile_use_case import update_profile
from app.application.follows.follow_user_use_case import follow_user
from app.application.follows.unfollow_user_use_case import unfollow_user
from app.domain.auth.exceptions import UserNotFoundError
from app.domain.follows.exceptions import CannotFollowSelfError
from app.domain.restrictions.exceptions import AccountBlockedError
from app.domain.tero import actions

logger = logging.getLogger(__name__)

_EXECUTION_FAILED = "No se pudo completar la acción."


def _card(row):
    return {
        "id": row["id"],
        "kind": row["kind"],
        "summary": row["summary"],
        "expires_at": row["expires_at"].isoformat(),
    }


def propose(user_id, kind, params, summary, action_repository, now=None):
    """Guarda la propuesta y devuelve la tarjeta. Lanza `TooManyPendingActionsError`."""
    now = now or datetime.now(timezone.utc)
    if action_repository.pending_count(user_id, now) >= actions.MAX_PENDING_PER_USER:
        raise actions.TooManyPendingActionsError()
    row = action_repository.create(
        user_id, kind, params, summary, now + timedelta(minutes=actions.EXPIRY_MINUTES)
    )
    logger.info("Tero action proposed kind=%s user=%s id=%s", kind, user_id, row["id"])
    return _card(row)


def _execute(row, user_id, deps):
    kind, params = row["kind"], row["params"]
    if kind == actions.KIND_FOLLOW:
        result = follow_user(
            user_id, UUID(params["target_id"]), deps.user_repository, deps.follow_repository,
            deps.notification_repository, deps.restriction_repository,
        )
        return {"follow_status": result["follow_status"]}
    if kind == actions.KIND_UNFOLLOW:
        unfollow_user(
            user_id, UUID(params["target_id"]), deps.user_repository, deps.follow_repository
        )
        return {"follow_status": None}
    if kind == actions.KIND_UPDATE_PROFILE:
        update_profile(user_id, params["changes"], deps.user_repository, deps.follow_repository)
        return {"updated": sorted(params["changes"])}
    # Un `kind` que ya no existe en el código (p. ej. tras un despliegue): no se ejecuta.
    raise actions.ActionExecutionError(_EXECUTION_FAILED)


def confirm(user_id, action_id, deps, now=None):
    """Confirma y ejecuta UNA vez. Devuelve `{"status", "result"?, "already_confirmed"?}`.

    · No es suya o no existe -> `ActionNotFoundError` (404).
    · Ya confirmada -> idempotente: no vuelve a ejecutar.
    · Cancelada o fallida -> `ActionNotPendingError` (409).
    · Vencida -> `ActionExpiredError` (409).
    · Ya no se puede ejecutar (bloqueo, cuenta borrada...) -> `ActionExecutionError`."""
    now = now or datetime.now(timezone.utc)
    repository = deps.action_repository

    row = repository.claim(action_id, user_id, now)
    if row is None:
        # No ganó la fila: descubrir por qué, sin ejecutar nada.
        existing = repository.get_owned(action_id, user_id)
        if existing is None:
            raise actions.ActionNotFoundError()
        if existing["status"] == actions.CONFIRMED:
            return {"status": actions.CONFIRMED, "already_confirmed": True}
        if existing["status"] == actions.PENDING:
            raise actions.ActionExpiredError()
        raise actions.ActionNotPendingError(existing["status"])

    try:
        result = _execute(row, user_id, deps)
    except (UserNotFoundError, AccountBlockedError, CannotFollowSelfError, actions.ActionExecutionError):
        repository.mark_failed(row["id"], now)
        logger.info("Tero action failed kind=%s user=%s id=%s", row["kind"], user_id, row["id"])
        raise actions.ActionExecutionError(_EXECUTION_FAILED) from None
    except Exception:  # noqa: BLE001 -- nada interno sale; la acción queda registrada como fallida
        repository.mark_failed(row["id"], now)
        logger.exception("Tero action crashed kind=%s id=%s", row["kind"], row["id"])
        raise actions.ActionExecutionError(_EXECUTION_FAILED) from None

    logger.info("Tero action confirmed kind=%s user=%s id=%s", row["kind"], user_id, row["id"])
    return {"status": actions.CONFIRMED, "result": result}


def cancel(user_id, action_id, action_repository, now=None):
    now = now or datetime.now(timezone.utc)
    if action_repository.cancel(action_id, user_id, now):
        logger.info("Tero action cancelled user=%s id=%s", user_id, action_id)
        return {"status": actions.CANCELLED}
    existing = action_repository.get_owned(action_id, user_id)
    if existing is None:
        raise actions.ActionNotFoundError()
    if existing["status"] == actions.CANCELLED:
        return {"status": actions.CANCELLED, "already_cancelled": True}
    # Ya confirmada o fallida: no se puede deshacer cancelando.
    raise actions.ActionNotPendingError(existing["status"])
