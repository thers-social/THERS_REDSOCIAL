# Validación de lo que se ESCRIBE en THERS Places (ADR-040, fase 2): crear y editar
# lugares, reportarlos y resolver reportes. Toda validación vive aquí, en el servidor:
# el cliente no es de fiar.
#
# IMPORTANTE (hallazgo de la fase 1): PostGIS NO rechaza coordenadas fuera de rango;
# guarda una latitud 95 como 85 sin avisar. Por eso toda escritura de coordenadas pasa
# antes por `validators.parse_coordinates`.

import re
import unicodedata

from app.domain.places import kinds, validators
from app.domain.places.exceptions import InvalidPlaceDataError, InvalidPlaceQueryError

_PHONE_RE = re.compile(r"^[0-9+()\-.\s]{3,%d}$" % kinds.MAX_PHONE_LENGTH)
_WEBSITE_RE = re.compile(r"^https?://[^\s]+$", re.IGNORECASE)
_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_SLUG_RE = re.compile(r"[^a-z0-9]+")

# Campos de texto opcionales de un lugar: (clave, etiqueta, longitud máxima).
_OPTIONAL_TEXT = (
    ("description", "description", kinds.MAX_DESCRIPTION_LENGTH),
    ("address", "address", kinds.MAX_ADDRESS_LENGTH),
    ("municipality", "municipality", kinds.MAX_AREA_LENGTH),
    ("department", "department", kinds.MAX_AREA_LENGTH),
)


def _text(value, label, max_length, required=False, multiline=False):
    """Texto recortado, sin caracteres de control. `None` si es opcional y está vacío."""
    if value is None or (isinstance(value, str) and not value.strip()):
        if required:
            raise InvalidPlaceDataError(f"{label} es obligatorio")
        return None
    if not isinstance(value, str):
        raise InvalidPlaceDataError(f"{label} debe ser texto")
    value = value.strip()
    if not multiline and ("\n" in value or "\r" in value or "\t" in value):
        raise InvalidPlaceDataError(f"{label} no puede tener saltos de línea")
    if _CONTROL_RE.search(value):
        raise InvalidPlaceDataError(f"{label} tiene caracteres no permitidos")
    if len(value) > max_length:
        raise InvalidPlaceDataError(f"{label} no puede superar {max_length} caracteres")
    return value


def _choice(value, label, allowed):
    if value not in allowed:
        raise InvalidPlaceDataError(f"{label} inválido")
    return value


def slugify(name):
    """Minúsculas, sin tildes, solo [a-z0-9-]. Nunca vacío."""
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    slug = _SLUG_RE.sub("-", ascii_name.lower()).strip("-")
    return slug[:150].strip("-") or "lugar"


def _coordinates(data):
    try:
        return validators.parse_coordinates(data.get("latitude"), data.get("longitude"))
    except InvalidPlaceQueryError as error:
        # Mismo mensaje con los nombres de los campos del cuerpo (latitude/longitude).
        raise InvalidPlaceDataError(
            error.message.replace("lat ", "latitude ").replace("lng ", "longitude ")
        )


def _phone(value):
    value = _text(value, "phone", kinds.MAX_PHONE_LENGTH)
    if value is not None and (not _PHONE_RE.match(value) or sum(c.isdigit() for c in value) < 3):
        raise InvalidPlaceDataError("phone no tiene un formato válido")
    return value


def _website(value):
    value = _text(value, "website", kinds.MAX_WEBSITE_LENGTH)
    if value is not None and not _WEBSITE_RE.match(value):
        raise InvalidPlaceDataError("website debe empezar con http:// o https://")
    return value


def _common_fields(data, present_only):
    """Campos opcionales que pueden venir al crear o editar. Con `present_only`
    solo se devuelven los que están en `data` (edición parcial)."""
    clean = {}
    for key, label, max_length in _OPTIONAL_TEXT:
        if not present_only or key in data:
            clean[key] = _text(
                data.get(key), label, max_length, multiline=(key == "description")
            )
    if not present_only or "phone" in data:
        clean["phone"] = _phone(data.get("phone"))
    if not present_only or "website" in data:
        clean["website"] = _website(data.get("website"))
    return clean


def validate_new_place(data):
    """Devuelve el diccionario limpio para crear un lugar. `category` es un slug que
    el caso de uso resuelve contra la base."""
    clean = {"name": _text(data.get("name"), "name", kinds.MAX_NAME_LENGTH, required=True)}
    clean["category"] = _text(data.get("category"), "category", 60, required=True)
    clean["latitude"], clean["longitude"] = _coordinates(data)
    clean.update(_common_fields(data, present_only=False))
    clean["source"] = _choice(
        data.get("source", kinds.SOURCE_THERS_FIELD), "source", kinds.SOURCES
    )
    clean["coordinate_source"] = _choice(
        data.get("coordinate_source", kinds.COORD_MAP_SELECTED),
        "coordinate_source",
        kinds.COORDINATE_SOURCES,
    )
    return clean


def validate_place_update(data):
    """Edición parcial: solo los campos presentes. Si cambian las coordenadas deben
    venir `latitude` y `longitude` juntas. No permite cambiar el estado (eso tiene su
    propia ruta, para dejarlo auditado aparte)."""
    clean = {}
    if "name" in data:
        clean["name"] = _text(data["name"], "name", kinds.MAX_NAME_LENGTH, required=True)
    if "category" in data:
        clean["category"] = _text(data["category"], "category", 60, required=True)
    if "latitude" in data or "longitude" in data:
        clean["latitude"], clean["longitude"] = _coordinates(data)
    clean.update(_common_fields(data, present_only=True))
    if "source" in data:
        clean["source"] = _choice(data["source"], "source", kinds.SOURCES)
    if "coordinate_source" in data:
        clean["coordinate_source"] = _choice(
            data["coordinate_source"], "coordinate_source", kinds.COORDINATE_SOURCES
        )
    if not clean:
        raise InvalidPlaceDataError("No se enviaron campos para actualizar")
    return clean


def validate_status_change(data):
    """`verification_status` y/o `is_active`. Al menos uno."""
    clean = {}
    if "verification_status" in data:
        clean["verification_status"] = _choice(
            data["verification_status"], "verification_status", kinds.VERIFICATION_STATUSES
        )
    if "is_active" in data:
        if not isinstance(data["is_active"], bool):
            raise InvalidPlaceDataError("is_active debe ser verdadero o falso")
        clean["is_active"] = data["is_active"]
    if not clean:
        raise InvalidPlaceDataError("Indica verification_status o is_active")
    return clean


def parse_search_query(raw):
    if raw is None or not str(raw).strip():
        raise InvalidPlaceQueryError("q es obligatorio")
    text = " ".join(str(raw).split())
    if _CONTROL_RE.search(text):
        raise InvalidPlaceQueryError("q tiene caracteres no permitidos")
    if len(text) < kinds.MIN_SEARCH_LENGTH:
        raise InvalidPlaceQueryError(f"q debe tener al menos {kinds.MIN_SEARCH_LENGTH} caracteres")
    if len(text) > kinds.MAX_SEARCH_LENGTH:
        raise InvalidPlaceQueryError(f"q no puede superar {kinds.MAX_SEARCH_LENGTH} caracteres")
    return text


def parse_report(reason, details):
    """Motivo y detalle de un reporte de datos incorrectos."""
    if not isinstance(reason, str):
        raise InvalidPlaceDataError("reason es obligatorio")
    reason = _choice(reason, "reason", kinds.REPORT_REASONS)
    details = _text(details, "details", kinds.MAX_REPORT_DETAILS_LENGTH, multiline=True)
    if reason == kinds.REPORT_OTHER and details is None:
        raise InvalidPlaceDataError("Cuéntanos qué pasa en details")
    return reason, details


def parse_resolution(status, note):
    if status not in kinds.REPORT_CLOSING_STATUSES:
        raise InvalidPlaceDataError("status debe ser resolved o dismissed")
    return status, _text(note, "note", kinds.MAX_NOTE_LENGTH, multiline=True)
