# Horario de apertura y cierres de un lugar (ADR-040 fase 9). Funciones PURAS, sin base de datos.
#
# Zona horaria: todos los lugares del catálogo están en El Salvador, que NO usa horario de
# verano (UTC-6 fijo). Por eso se usa un desfase fijo y no hace falta la base `tzdata`. Si un día
# entran lugares de otros países, la zona pasa a ser una columna de `places` (ADR-040 §25).
#
# Convención: `weekday` 0 = lunes … 6 = domingo (como `datetime.weekday()`). Un tramo no cruza la
# medianoche (un bar que cierra a las 02:00 se registra como dos tramos: hasta 23:45 y desde 00:00
# del día siguiente).

import re
from datetime import date, datetime, time, timedelta, timezone

from app.domain.reservations import kinds
from app.domain.reservations.exceptions import InvalidReservationDataError

PLACE_TZ = timezone(timedelta(hours=-6))
MAX_INTERVALS_PER_DAY = 3
MAX_CLOSURE_REASON = 120
MAX_CLOSURE_DAYS_AHEAD = 365
MAX_CALENDAR_DAYS = 31

_TIME_RE = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")
_CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")


def to_local(moment):
    return moment.astimezone(PLACE_TZ)


def parse_clock(value, label):
    """«HH:MM» en cuartos de hora exactos."""
    match = _TIME_RE.match(value) if isinstance(value, str) else None
    if not match:
        raise InvalidReservationDataError(f"{label} debe tener el formato HH:MM")
    hour, minute = int(match.group(1)), int(match.group(2))
    if minute % kinds.SLOT_MINUTES:
        raise InvalidReservationDataError(f"{label} debe ser en punto, y cuarto, y media o menos cuarto")
    return time(hour, minute)


def parse_week(days):
    """`[{weekday, intervals: [{opens, closes}]}]` -> `{weekday: [(opens, closes), ...]}`.
    Un día ausente o con lista vacía queda cerrado. Reemplaza el horario completo."""
    if not isinstance(days, list) or len(days) > 7:
        raise InvalidReservationDataError("days debe ser una lista de hasta 7 días")
    week = {}
    for day in days:
        if not isinstance(day, dict):
            raise InvalidReservationDataError("cada día debe ser un objeto")
        weekday = day.get("weekday")
        if isinstance(weekday, bool) or not isinstance(weekday, int) or not 0 <= weekday <= 6:
            raise InvalidReservationDataError("weekday debe ser un entero entre 0 (lunes) y 6 (domingo)")
        if weekday in week:
            raise InvalidReservationDataError("weekday repetido")
        raw = day.get("intervals", [])
        if not isinstance(raw, list) or len(raw) > MAX_INTERVALS_PER_DAY:
            raise InvalidReservationDataError(f"intervals admite hasta {MAX_INTERVALS_PER_DAY} tramos por día")
        intervals = []
        for item in raw:
            if not isinstance(item, dict):
                raise InvalidReservationDataError("cada tramo debe ser un objeto")
            opens = parse_clock(item.get("opens"), "opens")
            closes = parse_clock(item.get("closes"), "closes")
            if closes <= opens:
                raise InvalidReservationDataError("closes debe ser posterior a opens")
            intervals.append((opens, closes))
        intervals.sort()
        for (_, end), (start, _) in zip(intervals, intervals[1:]):
            if start < end:
                raise InvalidReservationDataError("los tramos de un día no pueden solaparse")
        week[weekday] = intervals
    return week


def parse_closure_date(value, today=None):
    if not isinstance(value, str):
        raise InvalidReservationDataError("date es obligatoria (AAAA-MM-DD)")
    try:
        parsed = date.fromisoformat(value.strip())
    except ValueError:
        raise InvalidReservationDataError("date no es una fecha válida (AAAA-MM-DD)")
    today = today or to_local(datetime.now(timezone.utc)).date()
    if parsed < today:
        raise InvalidReservationDataError("date no puede estar en el pasado")
    if parsed > today + timedelta(days=MAX_CLOSURE_DAYS_AHEAD):
        raise InvalidReservationDataError("date no puede estar a más de un año")
    return parsed


def parse_closure_reason(value):
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    if not isinstance(value, str):
        raise InvalidReservationDataError("reason debe ser texto")
    value = value.strip()
    if _CONTROL_RE.search(value):
        raise InvalidReservationDataError("reason tiene caracteres no permitidos")
    if len(value) > MAX_CLOSURE_REASON:
        raise InvalidReservationDataError(f"reason no puede superar {MAX_CLOSURE_REASON} caracteres")
    return value


def parse_range(start_raw, end_raw, today=None):
    """Rango de fechas del calendario del negocio: por defecto hoy + 14 días; máximo 31 días."""
    today = today or to_local(datetime.now(timezone.utc)).date()

    def one(raw, default):
        if raw in (None, ""):
            return default
        try:
            return date.fromisoformat(raw)
        except (TypeError, ValueError):
            raise InvalidReservationDataError("from y to deben ser fechas AAAA-MM-DD")

    start = one(start_raw, today)
    end = one(end_raw, start + timedelta(days=14))
    if end < start:
        raise InvalidReservationDataError("to no puede ser anterior a from")
    if (end - start).days + 1 > MAX_CALENDAR_DAYS:
        raise InvalidReservationDataError(f"el rango no puede superar {MAX_CALENDAR_DAYS} días")
    return start, end


def intervals_for(week, day):
    return week.get(day.weekday(), [])


def is_open_at(week, closures, moment):
    """Reglas para aceptar una reserva en `moment` (aware). Sin horario cargado no se restringe
    por hora (compatibilidad con la fase 8), pero un cierre puntual siempre cuenta.
    Devuelve `(True, None)` o `(False, motivo)` con motivo `closed_day` / `outside_hours`."""
    local = to_local(moment)
    if local.date() in closures:
        return False, "closed_day"
    if not week:
        return True, None
    clock = local.time().replace(second=0, microsecond=0)
    for opens, closes in intervals_for(week, local.date()):
        if opens <= clock < closes:  # la última hora de entrada es justo antes de cerrar
            return True, None
    return False, "outside_hours"


def slots_for_day(week, closures, day, now=None):
    """Horarios de entrada (cada 15 min) de un día, ya sin cierres ni horas pasadas.
    Sin horario cargado devuelve [] (no hay forma de saber cuándo abre)."""
    if day in closures:
        return []
    now = now or datetime.now(timezone.utc)
    earliest = now + timedelta(minutes=kinds.MIN_LEAD_MINUTES)
    slots = []
    for opens, closes in intervals_for(week, day):
        cursor = datetime.combine(day, opens, tzinfo=PLACE_TZ)
        end = datetime.combine(day, closes, tzinfo=PLACE_TZ)
        while cursor < end:
            if cursor >= earliest:
                slots.append(cursor.astimezone(timezone.utc))
            cursor += timedelta(minutes=kinds.SLOT_MINUTES)
    return slots
