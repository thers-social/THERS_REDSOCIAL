# Proveedor compuesto: usa el principal y, si no está disponible, el de respaldo (ADR-044).
#
# Tras un fallo del principal se le da un descanso (`COOLDOWN_SECONDS`): así, mientras el servicio
# esté caído, las personas no esperan en cada ruta el tiempo de espera completo del principal.
# Solo se cae al respaldo con `RoutingUnavailableError`; «no hay ruta» (`RouteNotFoundError`) es una
# respuesta válida del principal y se propaga tal cual.

import logging
import time

from app.domain.routing import routing
from app.domain.routing.routing import RoutingProvider, RoutingUnavailableError

logger = logging.getLogger(__name__)

COOLDOWN_SECONDS = 120


class FallbackProvider(RoutingProvider):
    def __init__(self, primary, secondary, cooldown=COOLDOWN_SECONDS, clock=time.monotonic):
        self._primary = primary
        self._secondary = secondary
        self._cooldown = cooldown
        self._clock = clock
        self._skip_until = 0.0
        self.name = f"{primary.name}+{secondary.name}"

    def route(self, origin, destination, profile, language=routing.DEFAULT_LANGUAGE):
        if self._clock() >= self._skip_until:
            try:
                return self._primary.route(origin, destination, profile, language)
            except RoutingUnavailableError:
                self._skip_until = self._clock() + self._cooldown
                logger.warning("Proveedor de rutas principal no disponible; uso el de respaldo")
        try:
            return self._secondary.route(origin, destination, profile, language)
        except RoutingUnavailableError:
            if self._clock() < self._skip_until:
                # El principal estaba en descanso y el respaldo también falló: un último intento.
                return self._primary.route(origin, destination, profile, language)
            raise
