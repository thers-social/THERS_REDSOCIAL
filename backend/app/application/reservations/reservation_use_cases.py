# Casos de uso de las reservas (ADR-040 fase 8).
#
# El lugar debe ser público y haber activado las reservas (solo quien lo gestiona). Una persona
# solicita; quien gestiona confirma o rechaza; la persona puede cancelar mientras esté activa.
# El cupo lo garantiza el repositorio bajo bloqueo. Quien no es parte de una reserva recibe 404.

from app.application.media.media_url import media_url
from app.application.places.place_card import to_place_card
from app.domain.notifications import place_events
from app.domain.places.exceptions import PlaceNotFoundError
from app.domain.reservations import kinds, schedule, validators
from app.domain.reservations.exceptions import (
    InvalidReservationDataError,
    PlaceClosedAtThatTimeError,
    ReservationNotFoundError,
    ReservationResolvedError,
)


def _iso(value):
    return value.isoformat() if value is not None else None


def _present(row, card=None, with_person=False):
    data = {
        "id": str(row["id"]),
        "starts_at": _iso(row["starts_at"]),
        "party_size": row["party_size"],
        "note": row["note"],
        "status": row["status"],
        "decision_note": row["decision_note"],
        "created_at": _iso(row["created_at"]),
    }
    if with_person:
        data["user"] = {
            "id": str(row["user_id"]),
            "username": row["user_username"],
            "name": row["user_name"],
            "avatar_url": media_url(row["user_avatar_path"]),
        }
    else:
        data["place"] = card
    return data


def _require_manager(place_id, user_id, repository):
    # Mismo 404 que si el lugar no existiera.
    if not repository.is_manager(place_id, user_id) or not repository.public_place_exists(place_id):
        raise PlaceNotFoundError()


def _mine(reservation_id, user_id, repository):
    row = repository.get(reservation_id)
    if row is None or str(row["user_id"]) != str(user_id):
        raise ReservationNotFoundError()
    return row


def _one_own(row, repository):
    cards = repository.place_cards([row["place_id"]])
    return _present(row, to_place_card(row["place_id"], cards))


def settings(place_id, user_id, repository):
    _require_manager(place_id, user_id, repository)
    return repository.get_settings(place_id)


def update_settings(place_id, user_id, data, repository):
    _require_manager(place_id, user_id, repository)
    current = repository.get_settings(place_id)
    enabled = validators.parse_enabled(data["enabled"]) if "enabled" in data else current["enabled"]
    capacity = (
        validators.parse_int(data["capacity"], "capacity", 1, 500) if "capacity" in data
        else current["capacity"]
    )
    max_party = (
        validators.parse_int(data["max_party_size"], "max_party_size", 1, 50)
        if "max_party_size" in data else current["max_party_size"]
    )
    if max_party > capacity:
        raise InvalidReservationDataError("max_party_size no puede superar capacity")
    repository.upsert_settings(place_id, enabled, capacity, max_party)
    return repository.get_settings(place_id)


def create(user_id, place_id, data, repository):
    starts_at = validators.parse_starts_at(data.get("starts_at"))
    party_size = validators.parse_int(data.get("party_size"), "party_size", 1, 50)
    note = validators.parse_note(data.get("note"))
    if not repository.public_place_exists(place_id):
        raise PlaceNotFoundError()
    # Horario (fase 9): sin horario cargado solo cuentan los cierres puntuales.
    horizon = schedule.to_local(starts_at).date()
    is_open, reason = schedule.is_open_at(
        repository.get_week(place_id), repository.get_closures(place_id, horizon, horizon), starts_at
    )
    if not is_open:
        raise PlaceClosedAtThatTimeError(reason)
    reservation_id = repository.create(user_id, place_id, starts_at, party_size, note)
    repository.notify_managers(place_events.RESERVATION_NEW, place_id, reservation_id, user_id)
    return _one_own(repository.get(reservation_id), repository)


def list_own(user_id, repository):
    rows = repository.list_for_user(user_id, kinds.MAX_LIST)
    cards = repository.place_cards([r["place_id"] for r in rows])
    return [_present(r, to_place_card(r["place_id"], cards)) for r in rows]


def cancel(reservation_id, user_id, repository):
    row = _mine(reservation_id, user_id, repository)
    if not repository.cancel(reservation_id, user_id):
        raise ReservationResolvedError()
    repository.notify_managers(
        place_events.RESERVATION_CANCELLED, row["place_id"], row["id"], user_id
    )
    return _one_own(repository.get(row["id"]), repository)


def list_for_place(place_id, user_id, status, limit, offset, repository):
    _require_manager(place_id, user_id, repository)
    status = validators.parse_status(status)
    try:
        limit = min(int(limit), kinds.MAX_LIST) if limit not in (None, "") else 20
        offset = max(int(offset), 0) if offset not in (None, "") else 0
    except (TypeError, ValueError):
        raise InvalidReservationDataError("limit y offset deben ser números")
    if limit < 1:
        raise InvalidReservationDataError("limit debe ser mayor que cero")
    rows = repository.list_for_place(place_id, status, limit, offset)
    return [_present(r, with_person=True) for r in rows[:limit]], len(rows) > limit


def decide(place_id, reservation_id, user_id, confirm, note, repository):
    _require_manager(place_id, user_id, repository)
    note = validators.parse_note(note)
    row = repository.get(reservation_id)
    if row is None or str(row["place_id"]) != str(place_id):
        raise ReservationNotFoundError()
    if not repository.decide(reservation_id, place_id, user_id, confirm, note):
        raise ReservationResolvedError()
    repository.notify_people(
        place_events.RESERVATION_DECIDED, place_id, reservation_id, [row["user_id"]], user_id,
        detail=kinds.CONFIRMED if confirm else kinds.DECLINED,
    )
    return {"id": str(reservation_id), "status": kinds.CONFIRMED if confirm else kinds.DECLINED}
