# Fábrica del proveedor de rutas y su caché (ADR-040 fase 13). Un solo punto decide qué
# proveedor se usa, igual que `infrastructure/email/factory.py`. El estado vive en
# `app.extensions`, así cada aplicación (y cada prueba) tiene el suyo.

from app.infrastructure.routing.fallback import FallbackProvider
from app.infrastructure.routing.openrouteservice import OpenRouteServiceProvider
from app.infrastructure.routing.osrm import OsrmProvider
from app.infrastructure.routing.route_cache import RouteCache

_KEY = "thers_routing"


def _single(name, api_key):
    if name == "openrouteservice" and api_key:
        return OpenRouteServiceProvider(api_key)
    if name == "osrm":
        return OsrmProvider()  # sin clave
    return None


def create_provider(name, api_key, fallback_name=None):
    """El proveedor configurado, con el de respaldo detrás si se pidió (ADR-044).

    `None` si no hay ninguno utilizable (p. ej. falta la clave y no hay respaldo): la función queda
    desactivada en vez de fallar al primer uso. Si falta la clave pero hay respaldo, solo se usa el
    respaldo."""
    primary = _single(name, api_key)
    secondary = _single(fallback_name, api_key) if fallback_name and fallback_name != name else None
    if primary is not None and secondary is not None:
        return FallbackProvider(primary, secondary)
    return primary or secondary


def routing_state(app):
    """`{"provider": ..., "cache": ...}` de la aplicación; se crea la primera vez."""
    state = app.extensions.get(_KEY)
    if state is None:
        state = {
            "provider": create_provider(
                app.config.get("ROUTING_PROVIDER"),
                app.config.get("ROUTING_API_KEY"),
                app.config.get("ROUTING_FALLBACK_PROVIDER"),
            ),
            "cache": RouteCache(),
        }
        app.extensions[_KEY] = state
    return state
