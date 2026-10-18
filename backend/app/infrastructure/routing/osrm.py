# Adaptador del enrutador público de OpenStreetMap (FOSSGIS, OSRM), usado como RESPALDO de
# OpenRouteService (ADR-044). Mismo contrato que `OpenRouteServiceProvider`: solo habla HTTP y
# traduce a la forma del dominio. Sin clave y sin dependencias nuevas. NUNCA registra las
# coordenadas, y el texto de error del proveedor no se reenvía a nadie.
#
# Particularidad de OSRM: no entrega el texto de las indicaciones, solo el tipo de maniobra. Aquí
# se escriben (español e inglés) con el mismo vocabulario de tipos que ORS (`type`), de modo que
# la web y la app no distinguen de qué proveedor vino la ruta.

import json
import logging
import urllib.error
import urllib.request

from app.domain.routing import routing
from app.domain.routing.routing import RouteNotFoundError, RoutingProvider, RoutingUnavailableError

logger = logging.getLogger(__name__)

BASE_URL = "https://routing.openstreetmap.de"
MAX_RESPONSE_BYTES = 4 * 1024 * 1024
USER_AGENT = "THERS-Places/1.0 (routing fallback)"
# Perfil público -> servidor de FOSSGIS. El camino siempre dice «driving»: el perfil real lo fija el servidor.
_SERVERS = {"walk": "routed-foot", "bike": "routed-bike", "car": "routed-car"}
_NO_ROUTE_CODES = {"NoRoute", "NoSegment"}

# Tipos de maniobra de ORS (los que entiende el cliente).
_LEFT, _RIGHT, _SHARP_LEFT, _SHARP_RIGHT, _SLIGHT_LEFT, _SLIGHT_RIGHT = 0, 1, 2, 3, 4, 5
_STRAIGHT, _ROUNDABOUT, _EXIT_ROUNDABOUT, _UTURN, _ARRIVE, _DEPART = 6, 7, 8, 9, 10, 11
_KEEP_LEFT, _KEEP_RIGHT = 12, 13

_MODIFIER_TYPE = {
    "left": _LEFT,
    "right": _RIGHT,
    "sharp left": _SHARP_LEFT,
    "sharp right": _SHARP_RIGHT,
    "slight left": _SLIGHT_LEFT,
    "slight right": _SLIGHT_RIGHT,
    "straight": _STRAIGHT,
    "uturn": _UTURN,
}

_TEXT = {
    "es": {
        _LEFT: "Gira a la izquierda", _RIGHT: "Gira a la derecha",
        _SHARP_LEFT: "Gira bruscamente a la izquierda", _SHARP_RIGHT: "Gira bruscamente a la derecha",
        _SLIGHT_LEFT: "Gira ligeramente a la izquierda", _SLIGHT_RIGHT: "Gira ligeramente a la derecha",
        _STRAIGHT: "Sigue recto", _ROUNDABOUT: "Entra en la rotonda", _EXIT_ROUNDABOUT: "Sal de la rotonda",
        _UTURN: "Da la vuelta", _ARRIVE: "Has llegado a tu destino", _DEPART: "Empieza el recorrido",
        _KEEP_LEFT: "Mantente a la izquierda", _KEEP_RIGHT: "Mantente a la derecha",
        "on": " por ",
    },
    "en": {
        _LEFT: "Turn left", _RIGHT: "Turn right",
        _SHARP_LEFT: "Turn sharp left", _SHARP_RIGHT: "Turn sharp right",
        _SLIGHT_LEFT: "Turn slightly left", _SLIGHT_RIGHT: "Turn slightly right",
        _STRAIGHT: "Continue straight", _ROUNDABOUT: "Enter the roundabout", _EXIT_ROUNDABOUT: "Exit the roundabout",
        _UTURN: "Make a U-turn", _ARRIVE: "You have arrived", _DEPART: "Start",
        _KEEP_LEFT: "Keep left", _KEEP_RIGHT: "Keep right",
        "on": " onto ",
    },
}


def _maneuver_type(maneuver):
    kind, modifier = maneuver.get("type"), maneuver.get("modifier")
    if kind == "depart":
        return _DEPART
    if kind == "arrive":
        return _ARRIVE
    if kind in ("roundabout", "rotary", "roundabout turn"):
        return _ROUNDABOUT
    if kind in ("exit roundabout", "exit rotary"):
        return _EXIT_ROUNDABOUT
    if kind == "fork" and modifier in ("left", "slight left"):
        return _KEEP_LEFT
    if kind == "fork" and modifier in ("right", "slight right"):
        return _KEEP_RIGHT
    return _MODIFIER_TYPE.get(modifier, _STRAIGHT)


def _steps(route, language):
    """Indicaciones en el formato de ORS (`instruction`, `name`, `type`, `way_points`). Si algo no
    cuadra con la línea, devuelve `None`: la ruta sigue valiendo sin indicaciones."""
    text = _TEXT[language]
    line_length = len(route["geometry"]["coordinates"])
    steps, start = [], 0
    for step in route["legs"][0]["steps"]:
        points = len(step["geometry"]["coordinates"])
        if points < 1:
            return None
        end = start + points - 1
        kind = _maneuver_type(step.get("maneuver") or {})
        if end > line_length - 1:
            # OSRM cierra la ruta con un paso «llegada» de dos puntos idénticos: el último se pasa de largo.
            if kind == _ARRIVE and start <= line_length - 1:
                end = line_length - 1
            else:
                return None  # los pasos no caben en la línea: mejor sin indicaciones que mal ubicadas
        name = step.get("name") or ""
        street = name if name.strip() else "-"
        instruction = text[kind] + (f"{text['on']}{name}" if name.strip() and kind not in (_ARRIVE, _DEPART) else "")
        steps.append(
            {
                "instruction": instruction,
                "name": street,
                "type": kind,
                "distance": step["distance"],
                "duration": step["duration"],
                "way_points": [start, end],
            }
        )
        start = end
    return steps


class OsrmProvider(RoutingProvider):
    name = "osrm"

    def __init__(self, timeout=routing.PROVIDER_TIMEOUT_SECONDS, base_url=BASE_URL, opener=None):
        self._timeout = timeout
        self._base_url = base_url
        self._open = opener or urllib.request.urlopen

    def route(self, origin, destination, profile, language=routing.DEFAULT_LANGUAGE):
        server = _SERVERS[profile]
        language = language if language in _TEXT else routing.DEFAULT_LANGUAGE
        path = f"{origin[1]},{origin[0]};{destination[1]},{destination[0]}"
        request = urllib.request.Request(
            f"{self._base_url}/{server}/route/v1/driving/{path}?overview=full&geometries=geojson&steps=true",
            method="GET",
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        )
        try:
            with self._open(request, timeout=self._timeout) as response:
                raw = response.read(MAX_RESPONSE_BYTES + 1)
        except urllib.error.HTTPError as error:
            self._raise_for_http(error)
        except Exception:  # noqa: BLE001 - red, DNS, tiempo agotado...
            logger.warning("El enrutador de respaldo no respondió")
            raise RoutingUnavailableError("el proveedor no respondió") from None
        if len(raw) > MAX_RESPONSE_BYTES:
            raise RoutingUnavailableError("respuesta demasiado grande del proveedor")
        try:
            body = json.loads(raw)
        except Exception:  # noqa: BLE001
            raise RoutingUnavailableError("respuesta ilegible del proveedor") from None
        code = body.get("code") if isinstance(body, dict) else None
        if code in _NO_ROUTE_CODES:
            raise RouteNotFoundError()
        try:
            best = body["routes"][0]
            distance, duration = best["distance"], best["duration"]
            coordinates = best["geometry"]["coordinates"]
        except Exception:  # noqa: BLE001 - forma inesperada
            raise RoutingUnavailableError("respuesta ilegible del proveedor") from None
        try:
            raw_steps = _steps(best, language)
        except Exception:  # noqa: BLE001 - sin indicaciones: la ruta sigue valiendo
            raw_steps = None
        return routing.clean_result(distance, duration, coordinates, raw_steps)

    @staticmethod
    def _raise_for_http(error):
        status = error.code
        code = None
        try:
            code = json.loads(error.read(65536)).get("code")
        except Exception:  # noqa: BLE001
            code = None
        if status in (400, 404) and code in _NO_ROUTE_CODES:
            raise RouteNotFoundError() from None
        logger.warning("El enrutador de respaldo respondió %s", status)
        raise RoutingUnavailableError(f"el proveedor respondió {status}") from None
