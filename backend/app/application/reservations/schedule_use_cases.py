# Casos de uso del horario y el calendario de reservas (ADR-040 fase 9). La lógica de horas vive
# en `domain/reservations/schedule.py` (pura); aquí solo se orquesta. Editar horario y cierres es de
# quien gestiona el lugar (404 a cualquier otra cuenta); leer horario y huecos es de cualquiera con sesión.

from datetime import datetime, timedelta, timezone

from app.application.reservations.reservation_use_cases import _require_manager
from app.domain.places.exceptions import PlaceNotFoundError
from app.domain.reservations import schedule
from app.domain.reservations.exceptions import InvalidReservationDataError

SCHEDULE_HORIZON_DAYS = 90


def _clock(value):
    return value.strftime("%H:%M")


def _present_week(week):
    return [
        {
            "weekday": weekday,
            "intervals": [
                {"opens": _clock(opens), "closes": _clock(closes)} for opens, closes in week.get(weekday, [])
            ],
        }
        for weekday in range(7)
    ]


def _today():
    return schedule.to_local(datetime.now(timezone.utc)).date()


def _public(place_id, repository):
    if not repository.public_place_exists(place_id):
        raise PlaceNotFoundError()


def _day_bounds(start, end):
    """Rango UTC que cubre los días locales de `start` a `end` (ambos incluidos)."""
    lower = datetime.combine(start, datetime.min.time(), tzinfo=schedule.PLACE_TZ)
    upper = datetime.combine(end + timedelta(days=1), datetime.min.time(), tzinfo=schedule.PLACE_TZ)
    return lower.astimezone(timezone.utc), upper.astimezone(timezone.utc)


def public_schedule(place_id, repository):
    _public(place_id, repository)
    today = _today()
    closures = repository.get_closures(place_id, today, today + timedelta(days=SCHEDULE_HORIZON_DAYS))
    return {
        "timezone": "UTC-06:00",
        "days": _present_week(repository.get_week(place_id)),
        "closures": [{"date": d.isoformat(), "reason": r} for d, r in closures.items()],
    }


def set_week(place_id, user_id, data, repository):
    _require_manager(place_id, user_id, repository)
    week = schedule.parse_week(data.get("days"))
    repository.replace_week(place_id, week)
    return {"days": _present_week(repository.get_week(place_id))}


def add_closure(place_id, user_id, data, repository):
    _require_manager(place_id, user_id, repository)
    day = schedule.parse_closure_date(data.get("date"))
    reason = schedule.parse_closure_reason(data.get("reason"))
    repository.add_closure(place_id, day, reason)
    return {"date": day.isoformat(), "reason": reason}


def remove_closure(place_id, user_id, day_raw, repository):
    _require_manager(place_id, user_id, repository)
    try:
        from datetime import date

        day = date.fromisoformat(day_raw)
    except (TypeError, ValueError):
        raise InvalidReservationDataError("date no es una fecha válida (AAAA-MM-DD)")
    if not repository.delete_closure(place_id, day):
        raise PlaceNotFoundError()
    return {"deleted": True}


def calendar(place_id, user_id, start_raw, end_raw, repository):
    """Vista del negocio: por día, si abre, sus tramos, los cierres y cuántas reservas hay."""
    _require_manager(place_id, user_id, repository)
    start, end = schedule.parse_range(start_raw, end_raw)
    week = repository.get_week(place_id)
    closures = repository.get_closures(place_id, start, end)
    lower, upper = _day_bounds(start, end)
    booked = repository.reservations_by_day(place_id, lower, upper)
    days = []
    for offset in range((end - start).days + 1):
        day = start + timedelta(days=offset)
        counts = booked.get(day, {"pending": 0, "confirmed": 0, "people": 0})
        days.append(
            {
                "date": day.isoformat(),
                "closed": day in closures,
                "closure_reason": closures.get(day),
                "intervals": [
                    {"opens": _clock(o), "closes": _clock(c)} for o, c in schedule.intervals_for(week, day)
                ],
                "reservations": counts,
            }
        )
    return {"days": days}


def availability(place_id, day_raw, repository):
    """Horarios libres de un día para quien quiere reservar. Sin reservas activadas o sin horario
    cargado no hay huecos que ofrecer."""
    _public(place_id, repository)
    try:
        from datetime import date

        day = date.fromisoformat(day_raw) if day_raw else _today()
    except (TypeError, ValueError):
        raise InvalidReservationDataError("date no es una fecha válida (AAAA-MM-DD)")
    today = _today()
    if day < today or day > today + timedelta(days=90):
        raise InvalidReservationDataError("date debe estar entre hoy y 90 días")
    settings = repository.get_settings(place_id)
    if not settings["enabled"]:
        return {"date": day.isoformat(), "accepts_reservations": False, "slots": []}
    week = repository.get_week(place_id)
    closures = repository.get_closures(place_id, day, day)
    starts = schedule.slots_for_day(week, closures, day)
    lower, upper = _day_bounds(day, day)
    taken = repository.people_by_slot(place_id, lower, upper)
    return {
        "date": day.isoformat(),
        "accepts_reservations": True,
        # true = el lugar no cargó su horario y se ofrece el horario por defecto (ADR-051).
        "default_hours": not week,
        "max_party_size": settings["max_party_size"],
        "slots": [
            {"starts_at": s.isoformat(), "seats_left": max(settings["capacity"] - taken.get(s, 0), 0)}
            for s in starts
        ],
    }
