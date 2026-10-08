# Pruebas de integración de GET /api/places/categories, /api/places y
# /api/places/<id> (ADR-040, fase 1).

import uuid

import pytest

from app.domain.rate_limiting import policy
from tests.places.helpers import REF_LAT, REF_LNG, insert_place, north_of_reference

EXPECTED_CATEGORY_SLUGS = [
    "restaurantes", "cafes", "supermercados", "farmacias", "gasolineras", "hospitales",
    "universidades", "centros-comerciales", "parques", "entretenimiento", "hoteles", "otros",
]


# --- Categorías ------------------------------------------------------------


def test_categories_lists_seeded_categories_in_order(client):
    response = client.get("/api/places/categories")

    assert response.status_code == 200
    categories = response.get_json()["categories"]
    assert [c["slug"] for c in categories] == EXPECTED_CATEGORY_SLUGS
    assert set(categories[0]) == {"id", "slug", "name"}
    assert categories[1]["name"] == "Cafés"


def test_categories_does_not_require_authentication(client):
    assert client.get("/api/places/categories").status_code == 200


# --- Listado ---------------------------------------------------------------


def test_list_returns_only_public_places_ordered_by_name(client, app):
    with app.app_context():
        insert_place("Zeta")
        insert_place("Alfa")
        insert_place("Pendiente", status="pending")
        insert_place("Inactivo", active=False)

    response = client.get("/api/places")

    assert response.status_code == 200
    assert [p["name"] for p in response.get_json()["places"]] == ["Alfa", "Zeta"]


def test_list_has_no_distance_because_it_has_no_origin(client, app):
    with app.app_context():
        insert_place("Solo")

    place = client.get("/api/places").get_json()["places"][0]

    assert "distance_meters" not in place


def test_list_filters_by_category(client, app):
    with app.app_context():
        insert_place("Café uno", category="cafes")
        insert_place("Parque uno", category="parques")

    names = [p["name"] for p in client.get("/api/places?category=parques").get_json()["places"]]

    assert names == ["Parque uno"]


def test_list_paginates_with_limit_and_offset(client, app):
    with app.app_context():
        for name in ("A", "B", "C", "D", "E"):
            insert_place(name)

    def names(query):
        return [p["name"] for p in client.get(f"/api/places?{query}").get_json()["places"]]

    assert names("limit=2") == ["A", "B"]
    assert names("limit=2&offset=2") == ["C", "D"]
    assert names("limit=2&offset=4") == ["E"]
    assert names("offset=99") == []


@pytest.mark.parametrize(
    "query, fragment",
    [
        ("limit=0", "limit debe ser al menos 1"),
        ("limit=51", "limit no puede superar 50"),
        ("offset=-1", "offset debe ser al menos 0"),
        ("offset=abc", "offset debe ser un entero"),
        ("category=inexistente", "Categoría inválida"),
    ],
)
def test_list_rejects_invalid_parameters(client, query, fragment):
    response = client.get(f"/api/places?{query}")

    assert response.status_code == 400
    assert fragment in response.get_json()["msg"]


def test_list_preserves_accents_and_enye(client, app):
    with app.app_context():
        insert_place("Pupusería La Niña Ñandú", address="Calle Mañanitas #5, José Ñ")

    place = client.get("/api/places").get_json()["places"][0]

    assert place["name"] == "Pupusería La Niña Ñandú"
    assert place["address"] == "Calle Mañanitas #5, José Ñ"


def test_list_handles_long_names_and_missing_optional_fields(client, app):
    long_name = "N" * 160
    with app.app_context():
        insert_place(long_name)

    place = client.get("/api/places").get_json()["places"][0]

    assert place["name"] == long_name
    assert place["address"] is None


# --- Detalle ---------------------------------------------------------------


def test_detail_returns_the_full_place(client, app):
    with app.app_context():
        place_id = insert_place(
            "Café Aurora", lat=13.692941, lng=-89.218191, category="cafes",
            description="Terraza", address="Escalón", municipality="San Salvador",
            department="San Salvador", phone="+503 2222-0001", website="https://example.com",
            source="business", coordinate_source="map_selected",
        )

    response = client.get(f"/api/places/{place_id}")

    assert response.status_code == 200
    place = response.get_json()["place"]
    assert place["id"] == place_id
    assert place["name"] == "Café Aurora"
    assert place["category"]["slug"] == "cafes"
    assert place["latitude"] == pytest.approx(13.692941, abs=1e-6)
    assert place["longitude"] == pytest.approx(-89.218191, abs=1e-6)
    assert place["description"] == "Terraza"
    assert place["phone"] == "+503 2222-0001"
    assert place["source"] == "business"
    assert place["coordinate_source"] == "map_selected"
    assert place["last_verified_at"] is None
    assert "distance_meters" not in place


def test_detail_does_not_expose_internal_fields(client, app):
    with app.app_context():
        place_id = insert_place("Interno")

    place = client.get(f"/api/places/{place_id}").get_json()["place"]

    for private in ("created_by_user_id", "verified_by_user_id", "is_active", "location"):
        assert private not in place


def test_detail_is_404_for_unknown_id(client):
    response = client.get(f"/api/places/{uuid.uuid4()}")

    assert response.status_code == 404
    assert response.get_json() == {"msg": "Lugar no encontrado"}


def test_detail_is_404_for_a_malformed_id(client):
    assert client.get("/api/places/no-es-un-uuid").status_code == 404


@pytest.mark.parametrize("kwargs", [{"status": "pending"}, {"status": "rejected"}, {"active": False}])
def test_detail_is_indistinguishable_404_for_non_public_places(client, app, kwargs):
    with app.app_context():
        place_id = insert_place("No público", **kwargs)

    response = client.get(f"/api/places/{place_id}")

    # Mismo cuerpo y código que un id inexistente: no revela que el lugar existe.
    assert response.status_code == 404
    assert response.get_json() == {"msg": "Lugar no encontrado"}


# --- Verbos y límite de uso ------------------------------------------------


@pytest.mark.parametrize("method", ["post", "put", "patch", "delete"])
def test_places_endpoints_are_read_only(client, method):
    assert getattr(client, method)("/api/places").status_code == 405


def test_reads_are_rate_limited_per_ip(client):
    limit = policy.PLACES_READ.limit

    for _ in range(limit):
        assert client.get("/api/places/categories").status_code == 200
    response = client.get("/api/places/categories")

    assert response.status_code == 429
    assert "Retry-After" in response.headers
    assert "msg" in response.get_json()


def test_rate_limit_is_independent_for_each_ip(client):
    limit = policy.PLACES_READ.limit
    for _ in range(limit + 1):
        client.get("/api/places/categories", headers={"X-Forwarded-For": "203.0.113.1"})

    other = client.get("/api/places/categories", headers={"X-Forwarded-For": "203.0.113.2"})

    assert other.status_code == 200


def test_error_responses_use_msg_key_only(client):
    body = client.get("/api/places/nearby").get_json()

    assert set(body) == {"msg"}
