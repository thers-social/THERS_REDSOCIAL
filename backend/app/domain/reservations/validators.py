# Validación de lo que se ESCRIBE en una reserva (ADR-040 fase 8).

import re
from datetime import datetime, timedelta, timezone

from app.domain.reservations import kinds
from app.domain.reservations.exceptions import InvalidReservationDataError

_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def parse_note(value):
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    if not isinstance(value, str):
        raise InvalidReservationDataError("note debe ser texto")
    value = value.strip()
    if _CONTROL_RE.search(value):
        raise InvalidReservationDataError("note tiene caracteres no permitidos")
    if len(value) > kinds.MAX_NOTE_LENGTH:
        raise InvalidReservationDataError(f"note no puede superar {kinds.MAX_NOTE_LENGTH} caracteres")
    return value


def parse_int(value, label, minimum, maximum):
    # `bool` es subclase de int: se rechaza a propósito.
    if isinstance(value, bool) or not isinstance(value, int):
        raise InvalidReservationDataError(f"{label} debe ser un número entero")
    if not minimum <= value <= maximum:
        raise InvalidReservationDataError(f"{label} debe estar entre {minimum} y {maximum}")
    return value


def parse_starts_at(value, now=None):
    """ISO-8601 CON zona horaria, en cuartos de hora exactos, con al menos 30 min de
    anticipación y a menos de 90 días."""
    if not isinstance(value, str) or not value.strip():
        raise InvalidReservationDataError("starts_at es obligatorio")
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        raise InvalidReservationDataError("starts_at no es una fecha válida")
    if parsed.tzinfo is None:
        raise InvalidReservationDataError("starts_at debe incluir zona horaria")
    parsed = parsed.astimezone(timezone.utc)
    if parsed.second or parsed.microsecond or parsed.minute % kinds.SLOT_MINUTES:
        raise InvalidReservationDataError("starts_at debe ser en punto, y cuarto, y media o menos cuarto")
    now = now or datetime.now(timezone.utc)
    if parsed < now + timedelta(minutes=kinds.MIN_LEAD_MINUTES):
        raise InvalidReservationDataError("starts_at debe ser al menos 30 minutos en el futuro")
    if parsed > now + timedelta(days=kinds.MAX_DAYS_AHEAD):
        raise InvalidReservationDataError("starts_at no puede estar a más de 90 días")
    return parsed


def parse_enabled(value):
    if not isinstance(value, bool):
        raise InvalidReservationDataError("enabled debe ser verdadero o falso")
    return value


def parse_status(value):
    if value is None or value == "":
        return None
    if value not in kinds.STATUSES:
        raise InvalidReservationDataError("status no es válido")
    return value
