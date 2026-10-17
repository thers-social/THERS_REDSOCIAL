# Rutas hacia un lugar (ADR-040 fase 13): constantes, errores, validación y el PUERTO del
# proveedor. Funciones puras, sin red ni base de datos. Los casos de uso solo conocen
# `RoutingProvider`; OpenRouteService es una implementación (`infrastructure/routing/`).
#
# PRIVACIDAD: el origen es la ubicación de una persona y sale a un tercero. Por eso se REDONDEA
# aquí (el servidor no confía en lo que redondeó el cliente) y nunca se guarda ni se registra.

import math
import re

from app.domain.places.exceptions import InvalidPlaceQueryError

# Nombre público -> perfil del proveedor. Lista cerrada: cualquier otro valor es un 400.
PROFILES = {"walk": "foot-walking", "bike": "cycling-regular", "car": "driving-car"}

ORIGIN_DECIMALS = 3  # ~110 m: el mismo redondeo que «cerca de ti»
ORIGIN_DECIMALS_HIGH = 4  # ~11 m: solo para recalcular una ruta en la navegación en vivo (ADR-040 §30)
PRECISIONS = ("normal", "high")
MAX_GEOMETRY_POINTS = 500  # tope de puntos de la línea que llega al cliente
CACHE_TTL_SECONDS = 60 * 60
CACHE_MAX_ENTRIES = 1000
PROVIDER_TIMEOUT_SECONDS = 8
MAX_DISTANCE_M = 10_000_000  # una respuesta con más es absurda: se descarta
MAX_DURATION_S = 10 * 365 * 24 * 3600

# Indicaciones calle por calle: idioma del texto y topes. El texto lo escribe el proveedor, así
# que se limpia y se acota antes de llegar al cliente.
LANGUAGES = ("es", "en")
DEFAULT_LANGUAGE = "es"
MAX_STEPS = 300
MAX_STEP_INSTRUCTION = 200
MAX_STEP_STREET = 120
_CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")


class RouteNotFoundError(Exception):
    """No hay ruta entre esos puntos con ese perfil (422)."""


class RoutingUnavailableError(Exception):
    """Sin clave, sin cupo, caído, lento o con respuesta inservible (503)."""


class RoutingProvider:
    """Puerto: devuelve `{"distance_m", "duration_s", "geometry"}` o lanza
    `RouteNotFoundError` / `RoutingUnavailableError`. `origin` y `destination` son `(lat, lng)`."""

    name = "unknown"

    def route(self, origin, destination, profile, language=DEFAULT_LANGUAGE):  # pragma: no cover
        raise NotImplementedError


def parse_profile(raw):
    if not isinstance(raw, str) or raw not in PROFILES:
        raise InvalidPlaceQueryError("profile debe ser walk, bike o car")
    return raw


def parse_language(raw):
    """Idioma de las indicaciones. Sin valor, español."""
    if raw is None:
        return DEFAULT_LANGUAGE
    if not isinstance(raw, str) or raw not in LANGUAGES:
        raise InvalidPlaceQueryError("lang debe ser es o en")
    return raw


def parse_precision(raw):
    """Precisión del origen. Sin valor, la normal; la alta exige pedirla de forma explícita."""
    if raw is None:
        return "normal"
    if not isinstance(raw, str) or raw not in PRECISIONS:
        raise InvalidPlaceQueryError("precision debe ser normal o high")
    return raw


def round_origin(lat, lng, precision="normal"):
    decimals = ORIGIN_DECIMALS_HIGH if precision == "high" else ORIGIN_DECIMALS
    return round(lat, decimals), round(lng, decimals)


def limit_points(coordinates, max_points=MAX_GEOMETRY_POINTS):
    """Reduce una lista de `[lng, lat]` a `max_points` como máximo, conservando el primero y el
    último. Sin simplificación geométrica: se toman puntos a intervalos regulares."""
    if len(coordinates) <= max_points:
        return list(coordinates)
    step = (len(coordinates) - 1) / (max_points - 1)
    picked = [coordinates[round(i * step)] for i in range(max_points)]
    picked[0], picked[-1] = coordinates[0], coordinates[-1]
    return picked


def _is_number(value):
    return not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value)


def _clean_text(value, max_length):
    if not isinstance(value, str):
        return None
    value = " ".join(_CONTROL_RE.sub(" ", value).split())
    return value[:max_length] if value else None


def clean_steps(raw_steps, line):
    """Indicaciones calle por calle. Son secundarias: si algo viene raro se devuelven vacías y
    la ruta sigue valiendo (nunca se rechaza una ruta buena por sus textos). `line` es la línea
    ya validada y completa, de la que sale el punto exacto de cada paso (`at`)."""
    if not isinstance(raw_steps, list) or len(raw_steps) > MAX_STEPS:
        return []
    steps = []
    for step in raw_steps:
        if not isinstance(step, dict):
            return []
        instruction = _clean_text(step.get("instruction"), MAX_STEP_INSTRUCTION)
        street = _clean_text(step.get("name"), MAX_STEP_STREET)
        distance, duration = step.get("distance"), step.get("duration")
        waypoints = step.get("way_points")
        kind = step.get("type")
        if (
            instruction is None
            or not _is_number(distance)
            or not _is_number(duration)
            or not 0 <= distance <= MAX_DISTANCE_M
            or not 0 <= duration <= MAX_DURATION_S
            or not isinstance(waypoints, list)
            or len(waypoints) != 2
            or any(isinstance(i, bool) or not isinstance(i, int) or not 0 <= i < len(line) for i in waypoints)
        ):
            return []
        steps.append(
            {
                "instruction": instruction,
                # El proveedor usa «-» para una vía sin nombre.
                "street": None if street in (None, "-") else street,
                "distance_m": int(round(distance)),
                "duration_s": int(round(duration)),
                "type": kind if isinstance(kind, int) and not isinstance(kind, bool) and 0 <= kind <= 20 else None,
                "at": line[waypoints[0]],
            }
        )
    return steps


def clean_result(distance, duration, coordinates, raw_steps=None):
    """Valida lo que devolvió un proveedor y arma la respuesta pública. Todo lo que no sea un
    número finito y razonable, o una línea de pares `[lng, lat]` válidos, se rechaza."""
    if not _is_number(distance) or not _is_number(duration):
        raise RoutingUnavailableError("respuesta inválida del proveedor")
    if not 0 <= distance <= MAX_DISTANCE_M or not 0 <= duration <= MAX_DURATION_S:
        raise RoutingUnavailableError("respuesta fuera de rango del proveedor")
    if not isinstance(coordinates, list) or len(coordinates) < 2:
        raise RoutingUnavailableError("línea inválida del proveedor")
    line = []
    for point in coordinates:
        if (
            not isinstance(point, (list, tuple))
            or len(point) < 2
            or not _is_number(point[0])
            or not _is_number(point[1])
            or not -180 <= point[0] <= 180
            or not -90 <= point[1] <= 90
        ):
            raise RoutingUnavailableError("punto inválido del proveedor")
        line.append([round(float(point[0]), 5), round(float(point[1]), 5)])
    return {
        "distance_m": int(round(distance)),
        "duration_s": int(round(duration)),
        "geometry": {"type": "LineString", "coordinates": limit_points(line)},
        "steps": clean_steps(raw_steps, line),
    }
