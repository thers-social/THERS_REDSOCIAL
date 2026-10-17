# Fábrica del proveedor de rutas y su caché (ADR-040 fase 13). Un solo punto decide qué
# proveedor se usa, igual que `infrastructure/email/factory.py`. El estado vive en
# `app.extensions`, así cada aplicación (y cada prueba) tiene el suyo.

from app.infrastructure.routing.openrouteservice import OpenRouteServiceProvider
from app.infrastructure.routing.route_cache import RouteCache

_KEY = "thers_routing"


def create_provider(name, api_key):
    """`None` si no hay clave: la función queda desactivada en vez de fallar al primer uso."""
    if not api_key:
        return None
    if name == "openrouteservice":
        return OpenRouteServiceProvider(api_key)
    return None


def routing_state(app):
    """`{"provider": ..., "cache": ...}` de la aplicación; se crea la primera vez."""
    state = app.extensions.get(_KEY)
    if state is None:
        state = {
            "provider": create_provider(
                app.config.get("ROUTING_PROVIDER"), app.config.get("ROUTING_API_KEY")
            ),
            "cache": RouteCache(),
        }
        app.extensions[_KEY] = state
    return state
