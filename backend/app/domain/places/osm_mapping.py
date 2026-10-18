# Traducción de las etiquetas de OpenStreetMap a las categorías de THERS Places (ADR-043).
# Solo tipos nativos de Python -- domain/ no importa Flask ni SQLAlchemy.
#
# Es una lista cerrada y explícita: un valor que no está aquí no se importa, en vez de caer
# en «otros» y llenar el mapa de ruido.

import re

# Cuadro que contiene a El Salvador (con margen). Descarta lo que la consulta de área deje pasar
# y coordenadas absurdas.
SV_MIN_LAT, SV_MAX_LAT = 13.0, 14.5
SV_MIN_LNG, SV_MAX_LNG = -90.2, -87.5

MAX_NAME_LENGTH = 160
MAX_ADDRESS_LENGTH = 255
MAX_WEBSITE_LENGTH = 255

# clave de OSM -> {valor -> categoría de THERS}
_AMENITY = {
    "cafe": "cafes",
    "restaurant": "restaurantes",
    "fast_food": "restaurantes",
    "food_court": "restaurantes",
    "ice_cream": "restaurantes",
    "bar": "entretenimiento",
    "pub": "entretenimiento",
    "nightclub": "entretenimiento",
    "biergarten": "entretenimiento",
    "cinema": "entretenimiento",
    "theatre": "entretenimiento",
    "arts_centre": "entretenimiento",
    "pharmacy": "farmacias",
    "hospital": "hospitales",
    "clinic": "hospitales",
    "doctors": "hospitales",
    "dentist": "hospitales",
    "fuel": "gasolineras",
    "university": "universidades",
    "college": "universidades",
    "school": "otros",
    "kindergarten": "otros",
    "bank": "otros",
    "library": "otros",
    "place_of_worship": "otros",
    "police": "otros",
    "fire_station": "otros",
    "post_office": "otros",
    "townhall": "otros",
    "marketplace": "otros",
    "community_centre": "otros",
    "car_wash": "otros",
    "veterinary": "otros",
}

_TOURISM = {
    "hotel": "hoteles",
    "hostel": "hoteles",
    "guest_house": "hoteles",
    "motel": "hoteles",
    "apartment": "hoteles",
    "camp_site": "hoteles",
    "attraction": "entretenimiento",
    "museum": "entretenimiento",
    "gallery": "entretenimiento",
    "theme_park": "entretenimiento",
    "zoo": "entretenimiento",
    "viewpoint": "entretenimiento",
}

_LEISURE = {
    "park": "parques",
    "garden": "parques",
    "playground": "parques",
    "nature_reserve": "parques",
    "sports_centre": "entretenimiento",
    "stadium": "entretenimiento",
    "fitness_centre": "entretenimiento",
    "golf_course": "entretenimiento",
}

_SHOP_SPECIFIC = {
    "supermarket": "supermercados",
    "convenience": "supermercados",
    "mall": "centros-comerciales",
    "department_store": "centros-comerciales",
    "chemist": "farmacias",
}

# Valores de `shop` que no son un comercio al que se vaya (o son una promesa de comercio).
_SHOP_IGNORED = {"vacant", "yes", "no"}

_CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")
_SPACES_RE = re.compile(r"\s+")


def category_for(tags):
    """Categoría de THERS (slug) para las etiquetas de un elemento de OSM, o `None` si no se importa."""
    amenity = tags.get("amenity")
    if amenity in _AMENITY:
        return _AMENITY[amenity]
    shop = tags.get("shop")
    if shop and shop not in _SHOP_IGNORED:
        return _SHOP_SPECIFIC.get(shop, "otros")
    if tags.get("tourism") in _TOURISM:
        return _TOURISM[tags["tourism"]]
    if tags.get("leisure") in _LEISURE:
        return _LEISURE[tags["leisure"]]
    return None


def clean_text(value, max_length):
    """Texto de una sola línea, sin caracteres de control; `None` si queda vacío."""
    if value is None:
        return None
    text = _SPACES_RE.sub(" ", _CONTROL_RE.sub(" ", str(value))).strip()
    if not text:
        return None
    return text[:max_length].rstrip()


def clean_website(value):
    """Solo `http(s)://` y de longitud razonable; cualquier otra cosa se descarta."""
    site = clean_text(value, MAX_WEBSITE_LENGTH + 1)
    if site is None or len(site) > MAX_WEBSITE_LENGTH:
        return None
    if not re.match(r"^https?://[^\s]+$", site, re.IGNORECASE):
        return None
    return site


def inside_el_salvador(lat, lng):
    return SV_MIN_LAT <= lat <= SV_MAX_LAT and SV_MIN_LNG <= lng <= SV_MAX_LNG


def address_for(tags):
    """Dirección legible armada con las etiquetas `addr:*`, o `None`."""
    street = clean_text(tags.get("addr:street"), 120)
    number = clean_text(tags.get("addr:housenumber"), 20)
    first = " ".join(part for part in (street, number) if part) or None
    parts = [first, clean_text(tags.get("addr:suburb"), 80), clean_text(tags.get("addr:city"), 80)]
    joined = ", ".join(part for part in parts if part)
    return clean_text(joined, MAX_ADDRESS_LENGTH)


def place_from_element(element):
    """Convierte un elemento de Overpass (`out center tags`) en los datos de un lugar, o `None`.

    No se importa: lo que no tiene nombre, lo que no es de una categoría conocida, lo que cae fuera
    de El Salvador ni nada con un identificador inesperado. El teléfono tampoco se copia: en OSM
    puede ser el de un particular (ADR-040 R6) y el lugar se contacta con su sitio web.
    """
    osm_type = element.get("type")
    osm_id = element.get("id")
    if osm_type not in ("node", "way", "relation") or not isinstance(osm_id, int) or osm_id <= 0:
        return None
    tags = element.get("tags") or {}
    name = clean_text(tags.get("name"), MAX_NAME_LENGTH)
    category = category_for(tags)
    if name is None or category is None:
        return None
    if osm_type == "node":
        lat, lng = element.get("lat"), element.get("lon")
    else:
        center = element.get("center") or {}
        lat, lng = center.get("lat"), center.get("lon")
    if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
        return None
    if not inside_el_salvador(lat, lng):
        return None
    return {
        "osm_type": osm_type,
        "osm_id": osm_id,
        "name": name,
        "category": category,
        "latitude": float(lat),
        "longitude": float(lng),
        "address": address_for(tags),
        "municipality": clean_text(tags.get("addr:city"), 100),
        "department": clean_text(tags.get("addr:state"), 100),
        "website": clean_website(tags.get("website") or tags.get("contact:website")),
    }
