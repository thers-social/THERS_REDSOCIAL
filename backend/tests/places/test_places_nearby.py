# Pruebas de integración de GET /api/places/nearby (ADR-040, fase 1) contra
# PostgreSQL + PostGIS reales.

import pytest

from tests.places.helpers import REF_LAT, REF_LNG, insert_place, north_of_reference

BASE = f"/api/places/nearby?lat={REF_LAT}&lng={REF_LNG}"


def _names(response):
    return [p["name"] for p in response.get_json()["places"]]


@pytest.fixture()
def abc(app):
    """A ~500 m, B ~2 km, C ~10 km al norte de la referencia."""
    with app.app_context():
        insert_place("Lugar A", lat=north_of_reference(500), lng=REF_LNG)
        insert_place("Lugar B", lat=north_of_reference(2000), lng=REF_LNG)
        insert_place("Lugar C", lat=north_of_reference(10000), lng=REF_LNG)


# --- Casos válidos y distancia ---------------------------------------------


def test_nearby_returns_a_and_b_but_not_c_within_3km(client, abc):
    response = client.get(f"{BASE}&radius=3000")

    assert response.status_code == 200
    assert _names(response) == ["Lugar A", "Lugar B"]


def test_nearby_orders_by_distance_and_reports_it(client, abc):
    places = client.get(f"{BASE}&radius=3000").get_json()["places"]

    a, b = places
    assert a["distance_meters"] < b["distance_meters"]
    assert abs(a["distance_meters"] - 500) <= 15
    assert abs(b["distance_meters"] - 2000) <= 15


def test_nearby_orders_by_distance_not_by_insertion(client, app):
    # Se inserta primero el más lejano: el orden de respuesta no puede ser el de inserción.
    with app.app_context():
        insert_place("Lejos", lat=north_of_reference(2500), lng=REF_LNG)
        insert_place("Cerca", lat=north_of_reference(100), lng=REF_LNG)
        insert_place("Medio", lat=north_of_reference(1200), lng=REF_LNG)

    assert _names(client.get(f"{BASE}&radius=5000")) == ["Cerca", "Medio", "Lejos"]


def test_nearby_default_radius_is_5km(client, abc):
    # Sin radius: A y B (≤ 2 km) entran, C (10 km) no.
    assert _names(client.get(BASE)) == ["Lugar A", "Lugar B"]


def test_nearby_max_radius_includes_far_places(client, abc):
    assert _names(client.get(f"{BASE}&radius=50000")) == ["Lugar A", "Lugar B", "Lugar C"]


def test_nearby_returns_empty_list_when_nothing_is_close(client, abc):
    response = client.get("/api/places/nearby?lat=0&lng=0&radius=1000")

    assert response.status_code == 200
    assert response.get_json() == {"places": []}


def test_nearby_respects_limit(client, abc):
    assert _names(client.get(f"{BASE}&radius=50000&limit=2")) == ["Lugar A", "Lugar B"]


def test_nearby_response_shape_has_no_invented_fields(client, abc):
    place = client.get(f"{BASE}&radius=3000").get_json()["places"][0]

    assert set(place) == {
        "id", "name", "slug", "category", "latitude", "longitude", "verification_status",
        "address", "cover_image_url", "distance_meters", "is_saved",
    }
    assert set(place["category"]) == {"id", "slug", "name"}
    # Sin reseñas, horarios ni guardados todavía: no se exponen valores ficticios.
    for invented in ("rating", "reviews_count", "is_open"):
        assert invented not in place
    assert place["cover_image_url"] is None
    assert place["is_saved"] is False  # sin sesión: no ha guardado nada


# --- Filtro por categoría --------------------------------------------------


def test_nearby_filters_by_category(client, app):
    with app.app_context():
        insert_place("Un café", lat=north_of_reference(300), lng=REF_LNG, category="cafes")
        insert_place("Una farmacia", lat=north_of_reference(400), lng=REF_LNG, category="farmacias")

    assert _names(client.get(f"{BASE}&category=cafes")) == ["Un café"]
    assert _names(client.get(f"{BASE}&category=farmacias")) == ["Una farmacia"]


# --- Visibilidad: lo no público nunca aparece ------------------------------


@pytest.mark.parametrize("status", ["pending", "needs_review", "rejected", "inactive"])
def test_nearby_excludes_non_verified_places(client, app, status):
    with app.app_context():
        insert_place("Visible", lat=north_of_reference(200), lng=REF_LNG)
        insert_place("Oculto", lat=north_of_reference(100), lng=REF_LNG, status=status)

    assert _names(client.get(f"{BASE}&radius=3000")) == ["Visible"]


def test_nearby_excludes_inactive_places(client, app):
    with app.app_context():
        insert_place("Visible", lat=north_of_reference(200), lng=REF_LNG)
        insert_place("Desactivado", lat=north_of_reference(100), lng=REF_LNG, active=False)

    assert _names(client.get(f"{BASE}&radius=3000")) == ["Visible"]


# --- Validación de parámetros ----------------------------------------------


@pytest.mark.parametrize(
    "query, fragment",
    [
        (f"lng={REF_LNG}", "lat es obligatorio"),
        (f"lat={REF_LAT}", "lng es obligatorio"),
        (f"lat=&lng={REF_LNG}", "lat es obligatorio"),
        (f"lat=91&lng={REF_LNG}", "lat debe estar entre -90 y 90"),
        (f"lat=-90.5&lng={REF_LNG}", "lat debe estar entre -90 y 90"),
        (f"lat={REF_LAT}&lng=181", "lng debe estar entre -180 y 180"),
        (f"lat={REF_LAT}&lng=-180.1", "lng debe estar entre -180 y 180"),
        (f"lat=abc&lng={REF_LNG}", "lat debe ser un número"),
        (f"lat=nan&lng={REF_LNG}", "lat debe ser un número"),
        (f"lat=inf&lng={REF_LNG}", "lat debe ser un número"),
        (f"lat={REF_LAT}&lng={REF_LNG}&radius=-5", "radius debe ser mayor que 0"),
        (f"lat={REF_LAT}&lng={REF_LNG}&radius=0", "radius debe ser mayor que 0"),
        (f"lat={REF_LAT}&lng={REF_LNG}&radius=50001", "radius no puede superar 50000"),
        (f"lat={REF_LAT}&lng={REF_LNG}&radius=mucho", "radius debe ser un número"),
        (f"lat={REF_LAT}&lng={REF_LNG}&radius=nan", "radius debe ser un número"),
        (f"lat={REF_LAT}&lng={REF_LNG}&limit=0", "limit debe ser al menos 1"),
        (f"lat={REF_LAT}&lng={REF_LNG}&limit=51", "limit no puede superar 50"),
        (f"lat={REF_LAT}&lng={REF_LNG}&limit=x", "limit debe ser un entero"),
        (f"lat={REF_LAT}&lng={REF_LNG}&category=no-existe", "Categoría inválida"),
        (f"lat={REF_LAT}&lng={REF_LNG}&category=NO%20VALIDA!", "Categoría inválida"),
        (f"lat={REF_LAT}&lng={REF_LNG}&category=" + "a" * 61, "Categoría inválida"),
    ],
)
def test_nearby_rejects_invalid_parameters(client, query, fragment):
    response = client.get(f"/api/places/nearby?{query}")

    assert response.status_code == 400
    assert fragment in response.get_json()["msg"]


def test_nearby_accepts_boundary_coordinates(client):
    for lat, lng in ((90, 180), (-90, -180), (0, 0)):
        assert client.get(f"/api/places/nearby?lat={lat}&lng={lng}").status_code == 200


def test_nearby_does_not_require_authentication(client, abc):
    # Catálogo público (ADR-040 D4): ni sin cabecera ni con un JWT inválido es 401.
    assert client.get(f"{BASE}&radius=3000").status_code == 200


def test_nearby_ignores_sql_injection_in_parameters(client, abc):
    response = client.get(f"{BASE}&category=cafes'%3B%20DROP%20TABLE%20places%3B--")

    assert response.status_code == 400
    # La tabla sigue intacta.
    assert len(client.get(f"{BASE}&radius=3000").get_json()["places"]) == 2
