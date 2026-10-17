# Validación de lo que se ESCRIBE en un reclamo (ADR-040 fase 6).

import re

from app.domain.claims import kinds
from app.domain.claims.exceptions import InvalidClaimDataError

_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_PHONE_RE = re.compile(r"^[0-9+()\-\s.]{6,40}$")


def _text(value, label, max_length, required=False, multiline=False):
    if value is None or (isinstance(value, str) and not value.strip()):
        if required:
            raise InvalidClaimDataError(f"{label} es obligatorio")
        return None
    if not isinstance(value, str):
        raise InvalidClaimDataError(f"{label} debe ser texto")
    value = value.strip()
    if not multiline and ("\n" in value or "\r" in value or "\t" in value):
        raise InvalidClaimDataError(f"{label} no puede tener saltos de línea")
    if _CONTROL_RE.search(value):
        raise InvalidClaimDataError(f"{label} tiene caracteres no permitidos")
    if len(value) > max_length:
        raise InvalidClaimDataError(f"{label} no puede superar {max_length} caracteres")
    return value


def parse_business_name(value):
    return _text(value, "business_name", kinds.MAX_BUSINESS_NAME_LENGTH, required=True)


def parse_message(value):
    return _text(value, "message", kinds.MAX_MESSAGE_LENGTH, multiline=True)


def parse_note(value, required=False):
    return _text(value, "note", kinds.MAX_NOTE_LENGTH, required=required, multiline=True)


def parse_phone(value):
    phone = _text(value, "contact_phone", kinds.MAX_PHONE_LENGTH)
    if phone is not None and not _PHONE_RE.match(phone):
        raise InvalidClaimDataError("contact_phone no es un teléfono válido")
    return phone


def parse_status(value):
    if value is None or value == "":
        return None
    if value not in kinds.CLAIM_STATUSES:
        raise InvalidClaimDataError("status no es válido")
    return value
