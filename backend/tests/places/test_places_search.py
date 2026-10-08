# Pruebas de GET /api/places/search (ADR-040, fase 2): texto sin importar mayúsculas ni
# tildes, comodines de LIKE neutralizados, distancia opcional y validación.

import pytest

from tests.places.helpers import REF_LAT, REF_LNG, insert_place, north_of_reference


@pytest.fixture()
def catalog(app):
    with app.app_context():
        insert_place("Café Aurora", lat=north_of_reference(500), lng=REF_LNG, category="cafes")
        insert_place("Pupusería La Niña Ñandú", lat=north_of_reference(2000), lng=REF_LNG, category="restaurantes")
        insert_place("Farmacia Económica", lat=north_of_reference(100), lng=REF_LNG, category="farmacias")
        insert_place("100% Natural", lat=north_of_reference(300), lng=REF_LNG)
        insert_place("Tienda_Uno", lat=north_of_reference(400), lng=REF_LNG)
        insert_place("Café Pendiente", status="pending")
        insert_place("Café Inactivo", active=False)


def _names(client, query, **params):
    response = client.get("/api/places/search", query_string={"q": query, **params})
    assert response.status_code == 200, response.get_json()
    return [p["name"] for p in response.get_json()["places"]]


@pytest.mark.parametrize("q", ["aurora", "AURORA", "Aurora", "auror", "ur"])
def test_search_ignores_case_and_matches_partial_text(client, catalog, q):
    assert "Café Aurora" in _names(client, q)


@pytest.mark.parametrize("q", ["cafe", "CAFÉ", "café", "Cafe Aurora"])
def test_search_ignores_accents_in_both_directions(client, catalog, q):
    assert "Café Aurora" in _names(client, q)


def test_search_matches_enye_and_accents_without_typing_them(client, catalog):
    assert _names(client, "nandu") == ["Pupusería La Niña Ñandú"]
    assert _names(client, "nina") == ["Pupusería La Niña Ñandú"]
    assert _names(client, "economica") == ["Farmacia Económica"]


def test_search_never_returns_non_public_places(client, catalog):
    names = _names(client, "cafe")

    assert names == ["Café Aurora"]


def test_search_returns_an_empty_list_when_nothing_matches(client, catalog):
    assert _names(client, "zzzzzz") == []


def test_search_treats_like_wildcards_as_plain_text(client, catalog):
    # `%` y `_` NO son comodines: "100%" solo encuentra el lugar que de verdad lo contiene.
    assert _names(client, "100%") == ["100% Natural"]
    assert _names(client, "a_U") == ["Tienda_Uno"]
    assert _names(client, "%%") == []
    assert _names(client, "__") == []
    assert _names(client, "!!") == []


def test_search_is_safe_against_sql_injection(client, catalog):
    for payload in ("'; DROP TABLE places;--", "' OR '1'='1", "\\\\", "a' UNION SELECT 1--"):
        response = client.get("/api/places/search", query_string={"q": payload})
        assert response.status_code == 200
        assert response.get_json() == {"places": []}
    assert _names(client, "aurora") == ["Café Aurora"]


def test_search_filters_by_category(client, catalog):
    assert _names(client, "ia", category="farmacias") == ["Farmacia Económica"]
    assert _names(client, "ia", category="parques") == []


def test_search_ranks_the_closest_text_first(client, app):
    with app.app_context():
        insert_place("Panadería El Sol Naciente")
        insert_place("Sol")
        insert_place("Solar Eventos")

    assert _names(client, "sol")[0] == "Sol"


def test_search_adds_distance_only_when_an_origin_is_given(client, catalog):
    without = client.get("/api/places/search?q=aurora").get_json()["places"][0]
    with_origin = client.get(
        f"/api/places/search?q=aurora&lat={REF_LAT}&lng={REF_LNG}"
    ).get_json()["places"][0]

    assert "distance_meters" not in without
    assert abs(with_origin["distance_meters"] - 500) <= 15


def test_search_respects_limit(client, app):
    with app.app_context():
        for i in range(3):
            insert_place(f"Plaza {i}")

    assert len(_names(client, "plaza", limit=2)) == 2
    assert len(_names(client, "plaza")) == 3


@pytest.mark.parametrize(
    "params, fragment",
    [
        ({}, "q es obligatorio"),
        ({"q": ""}, "q es obligatorio"),
        ({"q": "   "}, "q es obligatorio"),
        ({"q": "a"}, "al menos 2"),
        ({"q": "x" * 81}, "no puede superar 80"),
        ({"q": "ab\x00cd"}, "caracteres no permitidos"),
        ({"q": "ab", "lat": "13.7"}, "lng es obligatorio"),
        ({"q": "ab", "lng": "-89"}, "lat es obligatorio"),
        ({"q": "ab", "lat": "99", "lng": "0"}, "lat debe estar entre"),
        ({"q": "ab", "category": "no-existe"}, "Categoría inválida"),
        ({"q": "ab", "limit": "0"}, "limit debe ser al menos 1"),
    ],
)
def test_search_rejects_invalid_parameters(client, params, fragment):
    response = client.get("/api/places/search", query_string=params)

    assert response.status_code == 400
    assert fragment in response.get_json()["msg"]


def test_search_collapses_extra_whitespace(client, catalog):
    assert _names(client, "  cafe    aurora ") == ["Café Aurora"]


def test_search_does_not_require_authentication(client, catalog):
    assert client.get("/api/places/search?q=aurora").status_code == 200
