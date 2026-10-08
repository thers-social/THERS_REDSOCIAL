# Validación de los parámetros de consulta de THERS Places (ADR-040 §4.3).
# Toda validación importante ocurre aquí, en el servidor: el cliente no es de fiar.

import math
import re

from app.domain.places import kinds
from app.domain.places.exceptions import InvalidPlaceQueryError

_CATEGORY_SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
_MAX_CATEGORY_SLUG_LENGTH = 60


def _to_finite_float(raw, label):
    if raw is None or str(raw).strip() == "":
        raise InvalidPlaceQueryError(f"{label} es obligatorio")
    try:
        value = float(str(raw).strip())
    except (TypeError, ValueError):
        raise InvalidPlaceQueryError(f"{label} debe ser un número")
    # float() acepta "nan" e "inf"; ninguno es una coordenada ni un radio.
    if not math.isfinite(value):
        raise InvalidPlaceQueryError(f"{label} debe ser un número")
    return value


def parse_coordinates(lat_raw, lng_raw):
    lat = _to_finite_float(lat_raw, "lat")
    lng = _to_finite_float(lng_raw, "lng")
    if not -90 <= lat <= 90:
        raise InvalidPlaceQueryError("lat debe estar entre -90 y 90")
    if not -180 <= lng <= 180:
        raise InvalidPlaceQueryError("lng debe estar entre -180 y 180")
    return lat, lng


def parse_radius(radius_raw):
    """Radio en metros. Sin valor, usa el predeterminado."""
    if radius_raw is None or str(radius_raw).strip() == "":
        return kinds.DEFAULT_RADIUS_METERS
    radius = _to_finite_float(radius_raw, "radius")
    if radius <= 0:
        raise InvalidPlaceQueryError("radius debe ser mayor que 0")
    if radius > kinds.MAX_RADIUS_METERS:
        raise InvalidPlaceQueryError(
            f"radius no puede superar {kinds.MAX_RADIUS_METERS} metros"
        )
    return radius


def _parse_int(raw, label, default, minimum, maximum):
    if raw is None or str(raw).strip() == "":
        return default
    try:
        value = int(str(raw).strip())
    except (TypeError, ValueError):
        raise InvalidPlaceQueryError(f"{label} debe ser un entero")
    if value < minimum:
        raise InvalidPlaceQueryError(f"{label} debe ser al menos {minimum}")
    if value > maximum:
        raise InvalidPlaceQueryError(f"{label} no puede superar {maximum}")
    return value


def parse_limit(limit_raw):
    return _parse_int(limit_raw, "limit", kinds.DEFAULT_LIMIT, 1, kinds.MAX_LIMIT)


def parse_offset(offset_raw):
    return _parse_int(offset_raw, "offset", 0, 0, kinds.MAX_OFFSET)


def parse_category_slug(raw):
    """`None` si no se filtró por categoría. Formato inválido -> error 400."""
    if raw is None or str(raw).strip() == "":
        return None
    slug = str(raw).strip()
    if len(slug) > _MAX_CATEGORY_SLUG_LENGTH or not _CATEGORY_SLUG_RE.match(slug):
        raise InvalidPlaceQueryError("Categoría inválida")
    return slug
