# Adaptador de OpenRouteService (ADR-040 fase 13). Solo habla HTTP con el proveedor y traduce
# sus errores al vocabulario del dominio. Sin dependencias nuevas: `urllib` de la biblioteca
# estándar. NUNCA registra la clave ni las coordenadas, y el texto de error del proveedor no
# se reenvía a nadie.

import json
import logging
import urllib.error
import urllib.request

from app.domain.routing import routing
from app.domain.routing.routing import RouteNotFoundError, RoutingProvider, RoutingUnavailableError

logger = logging.getLogger(__name__)

BASE_URL = "https://api.openrouteservice.org/v2/directions"
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
# Códigos de error de ORS para «no hay ruta» (punto no ruteable, distancia excedida...).
_NO_ROUTE_CODES = {2004, 2009, 2010}


class OpenRouteServiceProvider(RoutingProvider):
    name = "openrouteservice"

    def __init__(self, api_key, timeout=routing.PROVIDER_TIMEOUT_SECONDS, base_url=BASE_URL, opener=None):
        self._api_key = api_key
        self._timeout = timeout
        self._base_url = base_url
        self._open = opener or urllib.request.urlopen

    def route(self, origin, destination, profile, language=routing.DEFAULT_LANGUAGE):
        body = json.dumps(
            {
                "coordinates": [[origin[1], origin[0]], [destination[1], destination[0]]],
                "language": language,
                "instructions": True,
            }
        ).encode()
        request = urllib.request.Request(
            f"{self._base_url}/{routing.PROFILES[profile]}/geojson",
            data=body,
            method="POST",
            headers={
                "Authorization": self._api_key,
                "Content-Type": "application/json; charset=utf-8",
                "Accept": "application/geo+json, application/json",
            },
        )
        try:
            with self._open(request, timeout=self._timeout) as response:
                raw = response.read(MAX_RESPONSE_BYTES + 1)
        except urllib.error.HTTPError as error:
            self._raise_for_http(error)
        except Exception:  # noqa: BLE001 - red, DNS, tiempo agotado...
            logger.warning("OpenRouteService no respondió")
            raise RoutingUnavailableError("el proveedor no respondió") from None
        if len(raw) > MAX_RESPONSE_BYTES:
            raise RoutingUnavailableError("respuesta demasiado grande del proveedor")
        try:
            feature = json.loads(raw)["features"][0]
            summary = feature["properties"]["summary"]
            distance, duration = summary["distance"], summary["duration"]
            coordinates = feature["geometry"]["coordinates"]
        except Exception:  # noqa: BLE001 - forma inesperada
            raise RoutingUnavailableError("respuesta ilegible del proveedor") from None
        try:
            raw_steps = feature["properties"]["segments"][0]["steps"]
        except Exception:  # noqa: BLE001 - sin indicaciones: la ruta sigue valiendo
            raw_steps = None
        return routing.clean_result(distance, duration, coordinates, raw_steps)

    @staticmethod
    def _raise_for_http(error):
        status = error.code
        code = None
        try:
            code = json.loads(error.read(65536)).get("error", {}).get("code")
        except Exception:  # noqa: BLE001
            code = None
        if status in (400, 404) and code in _NO_ROUTE_CODES:
            raise RouteNotFoundError() from None
        # 401/403 (clave mala), 429 (cupo del proveedor), 5xx y cualquier otro: no disponible.
        logger.warning("OpenRouteService respondió %s", status)
        raise RoutingUnavailableError(f"el proveedor respondió {status}") from None
