# Validación de lo que se ESCRIBE en un plan (ADR-040 fase 5).

import re
import uuid
from datetime import datetime, timedelta, timezone

from app.domain.plans import kinds
from app.domain.plans.exceptions import InvalidPlanDataError

_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def _text(value, label, max_length, required=False, multiline=False):
    if value is None or (isinstance(value, str) and not value.strip()):
        if required:
            raise InvalidPlanDataError(f"{label} es obligatorio")
        return None
    if not isinstance(value, str):
        raise InvalidPlanDataError(f"{label} debe ser texto")
    value = value.strip()
    if not multiline and ("\n" in value or "\r" in value or "\t" in value):
        raise InvalidPlanDataError(f"{label} no puede tener saltos de línea")
    if _CONTROL_RE.search(value):
        raise InvalidPlanDataError(f"{label} tiene caracteres no permitidos")
    if len(value) > max_length:
        raise InvalidPlanDataError(f"{label} no puede superar {max_length} caracteres")
    return value


def parse_title(value):
    return _text(value, "title", kinds.MAX_TITLE_LENGTH, required=True)


def parse_note(value):
    return _text(value, "note", kinds.MAX_NOTE_LENGTH, multiline=True)


def parse_starts_at(value, now=None):
    """Fecha y hora ISO-8601 CON zona horaria, a futuro y a menos de un año."""
    if not isinstance(value, str) or not value.strip():
        raise InvalidPlanDataError("starts_at es obligatorio")
    text = value.strip()
    if text.endswith(("Z", "z")):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        raise InvalidPlanDataError("starts_at debe ser una fecha y hora ISO-8601") from None
    if parsed.tzinfo is None:
        raise InvalidPlanDataError("starts_at debe incluir la zona horaria")
    now = now or datetime.now(timezone.utc)
    if parsed <= now:
        raise InvalidPlanDataError("starts_at debe ser a futuro")
    if parsed > now + timedelta(days=kinds.MAX_DAYS_AHEAD):
        raise InvalidPlanDataError("starts_at no puede superar un año")
    return parsed.astimezone(timezone.utc)


def parse_user_ids(value, required=False):
    """Lista de UUID de texto, sin repetidos y sin pasar de `MAX_INVITES_PER_REQUEST`."""
    if value is None:
        value = []
    if not isinstance(value, list):
        raise InvalidPlanDataError("user_ids debe ser una lista")
    if required and not value:
        raise InvalidPlanDataError("user_ids es obligatorio")
    if len(value) > kinds.MAX_INVITES_PER_REQUEST:
        raise InvalidPlanDataError(
            f"No puedes invitar a más de {kinds.MAX_INVITES_PER_REQUEST} personas"
        )
    ids = []
    for item in value:
        if not isinstance(item, str):
            raise InvalidPlanDataError("user_ids tiene un id inválido")
        try:
            normalized = str(uuid.UUID(item))
        except ValueError:
            raise InvalidPlanDataError("user_ids tiene un id inválido") from None
        if normalized not in ids:
            ids.append(normalized)
    return ids


def parse_response(value):
    if value not in kinds.RESPONSES:
        raise InvalidPlanDataError("status debe ser 'going' o 'declined'")
    return value


def parse_scope(value):
    if value is None or value == "":
        return kinds.SCOPE_UPCOMING
    if value not in kinds.SCOPES:
        raise InvalidPlanDataError("scope inválido")
    return value
