# Caso de uso de las rutas hacia un lugar (ADR-040 fase 13).
#
# El DESTINO sale siempre de la base de datos (el punto guardado del lugar): el cliente solo
# manda el origen y el perfil. El origen se redondea aquí y no se guarda. La caché se consulta
# ANTES de gastar cupo del proveedor, así una consulta repetida no cuesta nada.

from app.domain.places import validators
from app.domain.places.exceptions import InvalidPlaceQueryError, PlaceNotFoundError
from app.domain.routing import routing
from app.domain.routing.routing import RoutingUnavailableError


def get_route(place_id, data, place_repository, provider, cache, consume_budget):
    """`consume_budget` es una función que lanza `RoutingUnavailableError` si se agotó el cupo
    diario del proveedor; solo se llama cuando hay que consultarlo de verdad."""
    if not isinstance(data, dict):
        raise InvalidPlaceQueryError("Se esperaba un objeto JSON")
    lat, lng = validators.parse_coordinates(data.get("from_lat"), data.get("from_lng"))
    profile = routing.parse_profile(data.get("profile"))
    language = routing.parse_language(data.get("lang"))
    precision = routing.parse_precision(data.get("precision"))

    place = place_repository.get_public_place(place_id)
    if place is None:
        raise PlaceNotFoundError()
    if provider is None:
        raise RoutingUnavailableError("sin proveedor de rutas configurado")

    origin = routing.round_origin(lat, lng, precision)
    key = (str(place_id), origin, profile, language)
    result = cache.get(key)
    if result is None:
        consume_budget()
        result = provider.route(origin, (place["latitude"], place["longitude"]), profile, language)
        cache.set(key, result)
    return {
        "profile": profile,
        "provider": provider.name,
        "distance_m": result["distance_m"],
        "duration_s": result["duration_s"],
        "geometry": result["geometry"],
        "steps": result.get("steps", []),
        "lang": language,
    }
