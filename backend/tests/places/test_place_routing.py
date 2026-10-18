# Rutas hacia un lugar (ADR-040 fase 13): el destino sale de la base de datos, el origen se
# redondea en el servidor y no se guarda, hay caché y dos cupos (por cuenta y global), y ningún
# error filtra la clave ni el texto del proveedor. NINGUNA prueba llama a OpenRouteService:
# el proveedor es simulado y el adaptador real se prueba con una respuesta HTTP falsa.

import io
import json
import logging
import urllib.error

import pytest

from app.domain.places.exceptions import InvalidPlaceQueryError
from app.domain.rate_limiting import policy
from app.domain.rate_limiting.policy import RateLimitRule
from app.domain.routing import routing
from app.domain.routing.routing import RouteNotFoundError, RoutingProvider, RoutingUnavailableError
from app.infrastructure.routing.openrouteservice import OpenRouteServiceProvider
from app.infrastructure.routing.route_cache import RouteCache
from tests.places.helpers import REF_LAT, REF_LNG, auth, insert_place, make_users

MISSING = "00000000-0000-4000-8000-000000000000"
SECRET = "SECRET-KEY-DO-NOT-LEAK-123"
LINE = [[-89.2182, 13.6929], [-89.2200, 13.6950], [-89.2230, 13.6990]]


STEPS = [
    {"instruction": "Camina hacia el norte", "street": None, "distance_m": 100, "duration_s": 70, "type": 11, "at": LINE[0]},
    {"instruction": "Gira a la izquierda en 1a Calle Poniente", "street": "1a Calle Poniente", "distance_m": 1134,
     "duration_s": 251, "type": 0, "at": LINE[1]},
]


class FakeProvider(RoutingProvider):
    name = "fake"

    def __init__(self, error=None):
        self.calls = []
        self.languages = []
        self.error = error

    def route(self, origin, destination, profile, language="es"):
        self.calls.append((origin, destination, profile))
        self.languages.append(language)
        if self.error:
            raise self.error
        return {"distance_m": 1234, "duration_s": 321,
                "geometry": {"type": "LineString", "coordinates": LINE}, "steps": STEPS}


def _install(app, provider):
    app.extensions["thers_routing"] = {"provider": provider, "cache": RouteCache()}
    return provider


@pytest.fixture()
def world(app, client):
    users = make_users(app, client)
    with app.app_context():
        place_id = insert_place("Café Aurora")
    provider = _install(app, FakeProvider())
    return users, place_id, provider


def _route(client, token, place_id, **body):
    payload = {"from_lat": 13.69291, "from_lng": -89.21822, "profile": "walk", **body}
    return client.post(f"/api/places/{place_id}/route", json=payload, headers=auth(token))


# --- Lógica pura --------------------------------------------------------------------------


def test_origin_is_rounded_to_three_decimals():
    assert routing.round_origin(13.69291, -89.21822) == (13.693, -89.218)


@pytest.mark.parametrize("value", [None, "", "plane", "WALK", 1, ["walk"], {"a": 1}, True])
def test_profile_must_be_in_the_closed_list(value):
    with pytest.raises(InvalidPlaceQueryError):
        routing.parse_profile(value)


def test_limit_points_keeps_first_and_last_and_the_cap():
    points = [[float(i) / 1000, 13.0] for i in range(5000)]
    limited = routing.limit_points(points)
    assert len(limited) == routing.MAX_GEOMETRY_POINTS
    assert limited[0] == points[0] and limited[-1] == points[-1]
    assert routing.limit_points(points[:10]) == points[:10]


@pytest.mark.parametrize(
    "distance,duration,coords",
    [
        (True, 10, LINE), (10, True, LINE), (float("nan"), 10, LINE), (10, float("inf"), LINE),
        ("10", 10, LINE), (-1, 10, LINE), (routing.MAX_DISTANCE_M + 1, 10, LINE),
        (10, routing.MAX_DURATION_S + 1, LINE), (10, 10, None), (10, 10, [LINE[0]]), (10, 10, "x"),
        (10, 10, [[1], [2]]), (10, 10, [[200, 0], [0, 0]]), (10, 10, [[0, 95], [0, 0]]),
        (10, 10, [[float("nan"), 0], [0, 0]]), (10, 10, [["a", "b"], [0, 0]]), (10, 10, [[True, 0], [0, 0]]),
    ],
)
def test_provider_output_is_validated(distance, duration, coords):
    with pytest.raises(RoutingUnavailableError):
        routing.clean_result(distance, duration, coords)


def test_a_valid_provider_output_becomes_the_public_shape():
    result = routing.clean_result(1234.4, 320.6, LINE)
    assert result == {"distance_m": 1234, "duration_s": 321,
                      "geometry": {"type": "LineString", "coordinates": LINE}, "steps": []}


def test_precision_defaults_to_normal_and_high_rounds_to_four_decimals():
    assert routing.parse_precision(None) == "normal" and routing.parse_precision("high") == "high"
    for bad in ("ultra", "HIGH", "", 5, ["high"], True):
        with pytest.raises(InvalidPlaceQueryError):
            routing.parse_precision(bad)
    assert routing.round_origin(13.692913, -89.218227) == (13.693, -89.218)
    assert routing.round_origin(13.692913, -89.218227, "high") == (13.6929, -89.2182)
    assert routing.round_origin(13.692913, -89.218227, "normal") == (13.693, -89.218)


def test_language_defaults_to_spanish_and_only_allows_the_closed_list():
    assert routing.parse_language(None) == "es"
    assert routing.parse_language("en") == "en"
    for bad in ("fr", "ES", "", 5, ["es"], True):
        with pytest.raises(InvalidPlaceQueryError):
            routing.parse_language(bad)


def test_steps_are_cleaned_bounded_and_located_on_the_line():
    raw = [{"distance": 100.4, "duration": 30, "type": 1, "instruction": "Gira  a\x00 la\nderecha", "name": "-",
            "way_points": [0, 1]},
           {"distance": 5, "duration": 2, "type": 99, "instruction": "x" * 500, "name": "y" * 500, "way_points": [1, 2]}]
    steps = routing.clean_steps(raw, LINE)
    assert steps[0]["instruction"] == "Gira a la derecha" and steps[0]["street"] is None
    assert steps[0]["distance_m"] == 100 and steps[0]["at"] == LINE[0] and steps[0]["type"] == 1
    assert len(steps[1]["instruction"]) == routing.MAX_STEP_INSTRUCTION
    assert len(steps[1]["street"]) == routing.MAX_STEP_STREET and steps[1]["type"] is None


@pytest.mark.parametrize(
    "raw",
    [
        None, "x", {}, [1], [{}], [{"instruction": "x", "distance": 1, "duration": 1, "way_points": [0, 99]}],
        [{"instruction": "x", "distance": 1, "duration": 1, "way_points": [0]}],
        [{"instruction": "x", "distance": 1, "duration": 1, "way_points": [True, 1]}],
        [{"instruction": "x", "distance": "1", "duration": 1, "way_points": [0, 1]}],
        [{"instruction": "x", "distance": float("nan"), "duration": 1, "way_points": [0, 1]}],
        [{"instruction": "x", "distance": -1, "duration": 1, "way_points": [0, 1]}],
        [{"instruction": "", "distance": 1, "duration": 1, "way_points": [0, 1]}],
        [{"instruction": 5, "distance": 1, "duration": 1, "way_points": [0, 1]}],
        [{"instruction": "x", "distance": 1, "duration": 1, "way_points": [0, 1]}] * (routing.MAX_STEPS + 1),
    ],
)
def test_odd_steps_become_empty_but_never_break_the_route(raw):
    assert routing.clean_steps(raw, LINE) == []
    result = routing.clean_result(100, 10, LINE, raw)
    assert result["steps"] == [] and result["distance_m"] == 100


def test_the_cache_expires_and_evicts():
    now = {"t": 0.0}
    cache = RouteCache(ttl=10, max_entries=2, clock=lambda: now["t"])
    cache.set("a", 1)
    assert cache.get("a") == 1
    now["t"] = 11
    assert cache.get("a") is None
    cache.set("a", 1); cache.set("b", 2); cache.set("c", 3)
    assert cache.get("a") is None and cache.get("b") == 2 and cache.get("c") == 3


# --- Adaptador de OpenRouteService (con una respuesta HTTP falsa) ---------------------------


class _Response:
    def __init__(self, body):
        self._body = body if isinstance(body, bytes) else json.dumps(body).encode()

    def read(self, n=-1):
        return self._body if n < 0 else self._body[:n]

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


ORS_STEPS = [
    {"distance": 100.4, "duration": 70, "type": 11, "instruction": "Camina hacia el norte", "name": "-", "way_points": [0, 1]},
    {"distance": 899.6, "duration": 130, "type": 0, "instruction": "Gire a la izquierda a 1a Calle Poniente",
     "name": "1a Calle Poniente", "way_points": [1, 2]},
]


def _ors_ok(distance=1000, duration=200, coordinates=None, steps=ORS_STEPS):
    properties = {"summary": {"distance": distance, "duration": duration}}
    if steps is not None:
        properties["segments"] = [{"distance": distance, "duration": duration, "steps": steps}]
    return {"features": [{"properties": properties,
                          "geometry": {"type": "LineString", "coordinates": coordinates or LINE}}]}


def _http_error(status, body=b"{}"):
    return urllib.error.HTTPError("https://x", status, "err", {}, io.BytesIO(body))


def _provider(opener):
    return OpenRouteServiceProvider(SECRET, opener=opener)


def test_ors_sends_lon_lat_the_profile_and_the_key():
    seen = {}

    def opener(request, timeout):
        seen["url"], seen["auth"], seen["body"], seen["timeout"] = (
            request.full_url, request.get_header("Authorization"), json.loads(request.data), timeout)
        return _Response(_ors_ok())

    result = _provider(opener).route((13.693, -89.218), (13.7, -89.2), "bike")
    assert seen["url"].endswith("/cycling-regular/geojson")
    assert seen["body"]["coordinates"] == [[-89.218, 13.693], [-89.2, 13.7]]  # lon, lat
    assert seen["body"]["language"] == "es" and seen["body"]["instructions"] is True
    assert seen["auth"] == SECRET and seen["timeout"] == routing.PROVIDER_TIMEOUT_SECONDS
    assert result["distance_m"] == 1000 and result["geometry"]["coordinates"] == LINE


def test_ors_asks_for_the_language_and_returns_clean_steps():
    seen = {}

    def opener(request, timeout):
        seen["body"] = json.loads(request.data)
        return _Response(_ors_ok())

    result = _provider(opener).route((13.693, -89.218), (13.7, -89.2), "car", "en")
    assert seen["body"]["language"] == "en" and seen["body"]["instructions"] is True
    assert [s["street"] for s in result["steps"]] == [None, "1a Calle Poniente"]
    assert result["steps"][1]["distance_m"] == 900 and result["steps"][1]["at"] == LINE[1]


def test_ors_defaults_to_spanish():
    seen = {}
    _provider(lambda request, timeout: (seen.update(body=json.loads(request.data)), _Response(_ors_ok()))[1]).route((1, 1), (2, 2), "walk")
    assert seen["body"]["language"] == "es"


@pytest.mark.parametrize("steps", [None, [], "x", [{"nope": 1}]])
def test_ors_without_usable_steps_still_returns_the_route(steps):
    result = _provider(lambda request, timeout: _Response(_ors_ok(steps=steps))).route((1, 1), (2, 2), "walk")
    assert result["steps"] == [] and result["distance_m"] == 1000


@pytest.mark.parametrize("profile,expected", [("walk", "foot-walking"), ("bike", "cycling-regular"), ("car", "driving-car")])
def test_ors_profiles(profile, expected):
    urls = []
    _provider(lambda request, timeout: (urls.append(request.full_url), _Response(_ors_ok()))[1]).route((1, 1), (2, 2), profile)
    assert urls[0].endswith(f"/{expected}/geojson")


@pytest.mark.parametrize("code", [2004, 2009, 2010])
def test_ors_no_route_codes_are_a_422_case(code):
    body = json.dumps({"error": {"code": code, "message": "texto del proveedor"}}).encode()

    def opener(request, timeout):
        raise _http_error(404, body)

    with pytest.raises(RouteNotFoundError):
        _provider(opener).route((1, 1), (2, 2), "car")


@pytest.mark.parametrize("status", [400, 401, 403, 429, 500, 502, 503])
def test_ors_other_http_errors_are_unavailable(status, caplog):
    def opener(request, timeout):
        raise _http_error(status, b'{"error": {"code": 9999, "message": "detalle interno"}}')

    with caplog.at_level(logging.DEBUG), pytest.raises(RoutingUnavailableError) as raised:
        _provider(opener).route((13.69291, -89.21822), (2, 2), "car")
    assert SECRET not in str(raised.value) and "detalle interno" not in str(raised.value)
    assert SECRET not in caplog.text and "13.69291" not in caplog.text


@pytest.mark.parametrize("failure", [TimeoutError(), ConnectionError("dns"), OSError("red"), urllib.error.URLError("x")])
def test_ors_network_failures_are_unavailable(failure):
    def opener(request, timeout):
        raise failure

    with pytest.raises(RoutingUnavailableError):
        _provider(opener).route((1, 1), (2, 2), "walk")


@pytest.mark.parametrize("body", [b"no es json", b"{}", b'{"features": []}', b'{"features": [{}]}', json.dumps(_ors_ok(distance="x")).encode()])
def test_ors_garbage_is_unavailable(body):
    with pytest.raises(RoutingUnavailableError):
        _provider(lambda request, timeout: _Response(body)).route((1, 1), (2, 2), "walk")


def test_ors_oversized_responses_are_rejected_and_long_lines_trimmed():
    huge = b"x" * (2 * 1024 * 1024 + 10)
    with pytest.raises(RoutingUnavailableError):
        _provider(lambda request, timeout: _Response(huge)).route((1, 1), (2, 2), "walk")
    long_line = [[-89.0 + i * 0.00001, 13.0] for i in range(5000)]
    result = _provider(lambda request, timeout: _Response(_ors_ok(coordinates=long_line))).route((1, 1), (2, 2), "walk")
    assert len(result["geometry"]["coordinates"]) == routing.MAX_GEOMETRY_POINTS


# --- API ----------------------------------------------------------------------------------


def test_requires_a_session(client, world):
    _, place_id, provider = world
    assert client.post(f"/api/places/{place_id}/route", json={}).status_code == 401
    assert provider.calls == []


@pytest.mark.parametrize("profile", ["walk", "bike", "car"])
def test_each_profile_returns_a_route(client, world, profile):
    users, place_id, provider = world
    response = _route(client, users["ana"][0], place_id, profile=profile)
    assert response.status_code == 200
    route = response.get_json()["route"]
    assert set(route) == {"profile", "provider", "distance_m", "duration_s", "geometry", "steps", "lang"}
    assert route["profile"] == profile and route["provider"] == "fake"
    assert route["distance_m"] == 1234 and route["geometry"]["type"] == "LineString"
    assert response.headers["Cache-Control"] == "no-store"
    assert provider.calls[0][2] == profile


def test_the_route_carries_street_by_street_steps_in_the_requested_language(client, world):
    users, place_id, provider = world
    token = users["ana"][0]
    default = _route(client, token, place_id).get_json()["route"]
    assert default["lang"] == "es" and provider.languages == ["es"]
    assert [s["street"] for s in default["steps"]] == [None, "1a Calle Poniente"]
    assert set(default["steps"][1]) == {"instruction", "street", "distance_m", "duration_s", "type", "at"}
    english = _route(client, token, place_id, lang="en").get_json()["route"]
    assert english["lang"] == "en" and provider.languages == ["es", "en"]


def test_a_reroute_uses_a_finer_origin_only_when_it_asks_for_it(client, world):
    users, place_id, provider = world
    token = users["ana"][0]
    _route(client, token, place_id, from_lat=13.692913, from_lng=-89.218227)
    _route(client, token, place_id, from_lat=13.692913, from_lng=-89.218227, precision="high")
    _route(client, token, place_id, from_lat=13.692913, from_lng=-89.218227, precision="normal", profile="bike")
    assert provider.calls[0][0] == (13.693, -89.218)
    assert provider.calls[1][0] == (13.6929, -89.2182)  # nunca más fino que 4 decimales
    assert provider.calls[2][0] == (13.693, -89.218)


def test_reroutes_have_their_own_limit_and_do_not_share_the_normal_one(client, world, monkeypatch):
    users, place_id, provider = world
    token = users["ana"][0]
    monkeypatch.setattr(policy, "ROUTE_REQUEST", RateLimitRule("route_request", 1, 3600, False))
    monkeypatch.setattr(policy, "ROUTE_REROUTE", RateLimitRule("route_reroute", 2, 3600, False))
    assert _route(client, token, place_id).status_code == 200
    assert _route(client, token, place_id, profile="car").status_code == 429  # el normal se agotó
    for i in range(2):  # los recalculos tienen su propio cupo
        assert _route(client, token, place_id, precision="high", from_lat=13.69 + i / 1000).status_code == 200
    assert _route(client, token, place_id, precision="high", from_lat=13.7).status_code == 429
    assert _route(client, users["beto"][0], place_id, precision="high").status_code == 200  # otra cuenta


def test_a_reroute_is_cached_like_any_other_route(client, world):
    users, place_id, provider = world
    token = users["ana"][0]
    for _ in range(3):
        _route(client, token, place_id, precision="high")
    assert len(provider.calls) == 1


def test_the_cache_is_per_language(client, world):
    users, place_id, provider = world
    token = users["ana"][0]
    for lang in ("es", "es", "en", "en"):
        _route(client, token, place_id, lang=lang)
    assert provider.languages == ["es", "en"]


def test_a_provider_without_steps_still_gives_a_route(app, client, world):
    users, place_id, _ = world

    class NoSteps(FakeProvider):
        def route(self, origin, destination, profile, language="es"):
            result = super().route(origin, destination, profile, language)
            result.pop("steps")
            return result

    _install(app, NoSteps())
    route = _route(client, users["ana"][0], place_id).get_json()["route"]
    assert route["steps"] == [] and route["distance_m"] == 1234


def test_the_destination_comes_from_the_database_and_the_origin_is_rounded(client, world):
    users, place_id, provider = world
    _route(client, users["ana"][0], place_id, to_lat=0.0, to_lng=0.0, destination=[1, 1], lat=1, lng=1)
    origin, destination, _ = provider.calls[0]
    assert origin == (13.693, -89.218)  # el servidor redondea: el cliente no es de fiar
    assert destination == (pytest.approx(REF_LAT), pytest.approx(REF_LNG))


@pytest.mark.parametrize(
    "body",
    [
        {"from_lat": None}, {"from_lng": None}, {"from_lat": "abc"}, {"from_lat": "nan"}, {"from_lng": "inf"},
        {"from_lat": 91}, {"from_lat": -91}, {"from_lng": 181}, {"from_lng": -181}, {"from_lat": True},
        {"from_lat": [1]}, {"profile": "plane"}, {"profile": None}, {"profile": 5}, {"profile": "WALK"},
        {"lang": "fr"}, {"lang": "ES"}, {"lang": 5}, {"lang": ["es"]}, {"lang": True}, {"lang": ""},
        {"precision": "ultra"}, {"precision": "HIGH"}, {"precision": 5}, {"precision": ["high"]}, {"precision": True},
    ],
)
def test_invalid_input_is_a_400_and_never_reaches_the_provider(client, world, body):
    users, place_id, provider = world
    assert _route(client, users["ana"][0], place_id, **body).status_code == 400
    assert provider.calls == []


@pytest.mark.parametrize("raw", [b"", b"[]", b"5", b"no json"])
def test_the_body_must_be_a_json_object(client, world, raw):
    users, place_id, provider = world
    response = client.post(f"/api/places/{place_id}/route", data=raw, content_type="application/json",
                           headers=auth(users["ana"][0]))
    assert response.status_code == 400 and provider.calls == []


def test_unknown_inactive_and_pending_places_are_404(app, client, world):
    users, _, provider = world
    with app.app_context():
        inactive = insert_place("Cerrado", active=False)
        pending = insert_place("Pendiente", status="pending")
    for place_id in (MISSING, inactive, pending):
        assert _route(client, users["ana"][0], place_id).status_code == 404
    assert client.post("/api/places/no-es-uuid/route", json={}, headers=auth(users["ana"][0])).status_code == 404
    assert provider.calls == []


def test_the_same_query_is_served_from_the_cache(client, world):
    users, place_id, provider = world
    token = users["ana"][0]
    _route(client, token, place_id)
    _route(client, token, place_id)
    _route(client, token, place_id, from_lat=13.69304, from_lng=-89.21849)  # redondea igual
    assert len(provider.calls) == 1
    _route(client, token, place_id, profile="car")  # otro perfil
    _route(client, token, place_id, from_lat=13.7)  # otro origen
    assert len(provider.calls) == 3


def test_cache_keys_hold_only_the_rounded_origin(app, client, world):
    users, place_id, _ = world
    _route(client, users["ana"][0], place_id)
    keys = list(app.extensions["thers_routing"]["cache"]._items)
    assert keys == [(place_id, (13.693, -89.218), "walk", "es")]
    assert "13.69291" not in str(keys) and "89.21822" not in str(keys)


def test_the_exact_origin_never_reaches_the_logs(client, world, caplog):
    users, place_id, _ = world
    with caplog.at_level(logging.DEBUG):
        _route(client, users["ana"][0], place_id, from_lat=13.692913, from_lng=-89.218227)
    assert "13.692913" not in caplog.text and "89.218227" not in caplog.text


def test_the_per_account_limit_stops_before_the_provider(client, world, monkeypatch):
    users, place_id, provider = world
    monkeypatch.setattr(policy, "ROUTE_REQUEST", RateLimitRule("route_request", 2, 3600, False))
    token = users["ana"][0]
    assert _route(client, token, place_id).status_code == 200
    assert _route(client, token, place_id, profile="car").status_code == 200
    assert _route(client, token, place_id, profile="bike").status_code == 429
    assert len(provider.calls) == 2
    # Otra cuenta no queda afectada.
    assert _route(client, users["beto"][0], place_id, profile="bike").status_code == 200


def test_the_global_budget_only_counts_real_provider_calls(app, client, world):
    users, place_id, provider = world
    app.config["ROUTING_DAILY_BUDGET"] = 2
    token = users["ana"][0]
    assert _route(client, token, place_id, profile="walk").status_code == 200
    assert _route(client, token, place_id, profile="bike").status_code == 200
    assert _route(client, token, place_id, profile="walk").status_code == 200  # caché: no gasta cupo
    third = _route(client, token, place_id, profile="car")
    assert third.status_code == 503 and len(provider.calls) == 2
    # Otra cuenta también se queda sin cupo: es global. Pero lo ya cacheado sigue sirviendo.
    assert _route(client, users["beto"][0], place_id, profile="car").status_code == 503
    assert _route(client, users["beto"][0], place_id, profile="bike").status_code == 200


def test_provider_errors_map_to_fixed_messages(app, client, world):
    users, place_id, _ = world
    _install(app, FakeProvider(error=RouteNotFoundError()))
    assert _route(client, users["ana"][0], place_id).status_code == 422
    _install(app, FakeProvider(error=RoutingUnavailableError("detalle interno del proveedor " + SECRET)))
    response = _route(client, users["ana"][0], place_id)
    assert response.status_code == 503
    assert SECRET not in response.get_data(as_text=True) and "detalle interno" not in response.get_data(as_text=True)


def test_without_a_provider_it_is_unavailable_and_the_place_says_so(app, client, world):
    users, place_id, _ = world
    token = users["ana"][0]
    assert client.get(f"/api/places/{place_id}", headers=auth(token)).get_json()["place"]["routing_available"] is True
    _install(app, None)
    assert _route(client, token, place_id).status_code == 503
    assert client.get(f"/api/places/{place_id}", headers=auth(token)).get_json()["place"]["routing_available"] is False
    # También sin sesión: el catálogo público no se rompe.
    assert client.get(f"/api/places/{place_id}").get_json()["place"]["routing_available"] is False


def test_the_key_never_appears_in_a_response(app, client, world):
    users, place_id, _ = world

    def opener(request, timeout):
        raise _http_error(401, b'{"error": {"code": 1, "message": "bad key"}}')

    _install(app, OpenRouteServiceProvider(SECRET, opener=opener))
    response = _route(client, users["ana"][0], place_id)
    assert response.status_code == 503
    assert SECRET not in response.get_data(as_text=True)
    assert all(SECRET not in str(value) for value in response.headers.values())


def test_identity_is_the_token_not_the_body(client, world):
    users, place_id, provider = world
    response = _route(client, users["ana"][0], place_id, user_id=users["beto"][1])
    assert response.status_code == 200 and len(provider.calls) == 1


# --- Respaldo: enrutador público de OpenStreetMap y proveedor compuesto (ADR-044) ---

from app.infrastructure.routing.fallback import FallbackProvider  # noqa: E402
from app.infrastructure.routing.factory import create_provider  # noqa: E402
from app.infrastructure.routing.osrm import OsrmProvider  # noqa: E402

OSRM_ROUTE = {
    "code": "Ok",
    "routes": [{
        "distance": 1000.4, "duration": 200.2,
        "geometry": {"type": "LineString", "coordinates": [[-89.218, 13.693], [-89.21, 13.696], [-89.2, 13.7]]},
        "legs": [{"steps": [
            {"distance": 500, "duration": 100, "name": "Calle Uno",
             "maneuver": {"type": "depart"},
             "geometry": {"coordinates": [[-89.218, 13.693], [-89.21, 13.696]]}},
            {"distance": 500.4, "duration": 100.2, "name": "1a Calle Poniente",
             "maneuver": {"type": "turn", "modifier": "left"},
             "geometry": {"coordinates": [[-89.21, 13.696], [-89.2, 13.7]]}},
            {"distance": 0, "duration": 0, "name": "",
             "maneuver": {"type": "arrive"}, "geometry": {"coordinates": [[-89.2, 13.7]]}},
        ]}],
    }],
}


def _osrm(opener):
    return OsrmProvider(opener=opener)


@pytest.mark.parametrize("profile, server", [("walk", "routed-foot"), ("bike", "routed-bike"), ("car", "routed-car")])
def test_osrm_uses_the_server_of_each_profile_and_sends_lon_lat_without_a_key(profile, server):
    seen = {}

    def opener(request, timeout):
        seen["url"], seen["timeout"], seen["auth"] = request.full_url, timeout, request.get_header("Authorization")
        return _Response(OSRM_ROUTE)

    _osrm(opener).route((13.693, -89.218), (13.7, -89.2), profile)

    assert f"/{server}/route/v1/driving/-89.218,13.693;-89.2,13.7?" in seen["url"]
    assert seen["auth"] is None and seen["timeout"] == routing.PROVIDER_TIMEOUT_SECONDS


def test_osrm_returns_the_public_shape_with_written_steps_in_spanish_and_english():
    es = _osrm(lambda request, timeout: _Response(OSRM_ROUTE)).route((13.693, -89.218), (13.7, -89.2), "car")
    en = _osrm(lambda request, timeout: _Response(OSRM_ROUTE)).route((13.693, -89.218), (13.7, -89.2), "car", "en")

    assert es["distance_m"] == 1000 and es["geometry"]["coordinates"][0] == [-89.218, 13.693]
    assert [s["instruction"] for s in es["steps"]] == [
        "Empieza el recorrido", "Gira a la izquierda por 1a Calle Poniente", "Has llegado a tu destino"]
    assert es["steps"][1]["type"] == 0 and es["steps"][1]["street"] == "1a Calle Poniente"
    assert en["steps"][1]["instruction"] == "Turn left onto 1a Calle Poniente"


def test_osrm_steps_that_do_not_fit_the_line_are_dropped_but_the_route_stays():
    body = json.loads(json.dumps(OSRM_ROUTE))
    body["routes"][0]["legs"][0]["steps"][0]["geometry"]["coordinates"] = [[0, 0]] * 50

    result = _osrm(lambda request, timeout: _Response(body)).route((1, 1), (2, 2), "walk")

    assert result["distance_m"] == 1000 and result["steps"] == []


@pytest.mark.parametrize("code", ["NoRoute", "NoSegment"])
def test_osrm_no_route_is_a_422_case(code):
    with pytest.raises(RouteNotFoundError):
        _osrm(lambda request, timeout: _Response({"code": code})).route((1, 1), (2, 2), "walk")


@pytest.mark.parametrize("failure", [TimeoutError(), ConnectionError("dns"), urllib.error.URLError("x")])
def test_osrm_network_failures_and_garbage_are_unavailable(failure):
    def opener(request, timeout):
        raise failure

    with pytest.raises(RoutingUnavailableError):
        _osrm(opener).route((1, 1), (2, 2), "walk")
    for body in (b"no es json", b"{}", b'{"routes": []}', json.dumps({"routes": [{}]}).encode()):
        with pytest.raises(RoutingUnavailableError):
            _osrm(lambda request, timeout, body=body: _Response(body)).route((1, 1), (2, 2), "walk")


class _Stub(RoutingProvider):
    def __init__(self, name, result=None, error=None):
        self.name, self.result, self.error, self.calls = name, result, error, 0

    def route(self, origin, destination, profile, language="es"):
        self.calls += 1
        if self.error:
            raise self.error
        return self.result


def test_fallback_uses_the_primary_when_it_works():
    primary, secondary = _Stub("a", {"ok": "a"}), _Stub("b", {"ok": "b"})

    assert FallbackProvider(primary, secondary).route((1, 1), (2, 2), "walk") == {"ok": "a"}
    assert secondary.calls == 0


def test_fallback_switches_when_the_primary_is_unavailable_and_rests_it():
    now = {"t": 0.0}
    primary = _Stub("a", error=RoutingUnavailableError())
    secondary = _Stub("b", {"ok": "b"})
    provider = FallbackProvider(primary, secondary, cooldown=100, clock=lambda: now["t"])

    assert provider.route((1, 1), (2, 2), "walk") == {"ok": "b"}
    assert provider.route((1, 1), (2, 2), "walk") == {"ok": "b"}
    assert primary.calls == 1  # en descanso: no se le espera otra vez
    now["t"] = 101
    provider.route((1, 1), (2, 2), "walk")
    assert primary.calls == 2


def test_fallback_does_not_hide_a_real_no_route_answer():
    primary = _Stub("a", error=RouteNotFoundError())
    secondary = _Stub("b", {"ok": "b"})

    with pytest.raises(RouteNotFoundError):
        FallbackProvider(primary, secondary).route((1, 1), (2, 2), "walk")
    assert secondary.calls == 0


def test_fallback_gives_a_last_chance_to_the_rested_primary_and_then_fails():
    now = {"t": 0.0}
    primary = _Stub("a", error=RoutingUnavailableError())
    secondary = _Stub("b", error=RoutingUnavailableError())
    provider = FallbackProvider(primary, secondary, cooldown=100, clock=lambda: now["t"])

    with pytest.raises(RoutingUnavailableError):
        provider.route((1, 1), (2, 2), "walk")
    assert primary.calls == 2 and secondary.calls == 1


def test_the_factory_builds_primary_fallback_or_nothing():
    assert create_provider("openrouteservice", "k", "osrm").name == "openrouteservice+osrm"
    assert create_provider("openrouteservice", "k").name == "openrouteservice"
    assert create_provider("openrouteservice", None, "osrm").name == "osrm"  # sin clave: solo el respaldo
    assert create_provider("openrouteservice", None) is None
    assert create_provider("openrouteservice", "k", "openrouteservice").name == "openrouteservice"


def test_osrm_accepts_the_two_point_arrival_step_the_real_server_sends():
    body = json.loads(json.dumps(OSRM_ROUTE))
    body["routes"][0]["legs"][0]["steps"][2]["geometry"]["coordinates"] = [[-89.2, 13.7], [-89.2, 13.7]]

    result = _osrm(lambda request, timeout: _Response(body)).route((1, 1), (2, 2), "walk")

    assert [s["type"] for s in result["steps"]] == [11, 0, 10]
    assert result["steps"][-1]["at"] == [-89.2, 13.7]
