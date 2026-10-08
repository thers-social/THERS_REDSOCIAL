# Pruebas de la lógica de THERS Places que NO necesita base de datos (ADR-040):
# validadores de dominio y casos de uso con un repositorio falso.

import pytest

from app.application.places import place_use_cases
from app.domain.places import kinds, validators
from app.domain.places.exceptions import InvalidPlaceQueryError, PlaceNotFoundError


class FakeRepository:
    def __init__(self, rows=(), categories=("cafes",)):
        self.rows = list(rows)
        self.categories = set(categories)
        self.calls = []

    def category_exists(self, slug):
        return slug in self.categories

    def list_categories(self):
        return [{"id": "c1", "slug": "cafes", "name": "Cafés"}]

    def list_places(self, category, limit, offset, user_id=None):
        self.calls.append(("list", category, limit, offset))
        return self.rows

    def nearby(self, lat, lng, radius, category, limit, user_id=None):
        self.calls.append(("nearby", lat, lng, radius, category, limit))
        return self.rows

    def get_public_place(self, place_id, user_id=None):
        return self.rows[0] if self.rows else None


def _row(**overrides):
    row = {
        "id": "p1", "name": "Café", "slug": "cafe", "description": None, "address": None,
        "municipality": None, "department": None, "phone": None, "website": None,
        "verification_status": "verified", "source": "thers_field", "coordinate_source": "gps",
        "last_verified_at": None, "latitude": 13.0, "longitude": -89.0, "is_saved": False,
        "category_id": "c1", "category_slug": "cafes", "category_name": "Cafés",
    }
    row.update(overrides)
    return row


# --- Validadores -----------------------------------------------------------


def test_parse_coordinates_accepts_valid_values_and_whitespace():
    assert validators.parse_coordinates(" 13.69 ", "-89.21") == (13.69, -89.21)


@pytest.mark.parametrize("lat, lng", [("91", "0"), ("-91", "0"), ("0", "181"), ("0", "-181")])
def test_parse_coordinates_rejects_out_of_range(lat, lng):
    with pytest.raises(InvalidPlaceQueryError):
        validators.parse_coordinates(lat, lng)


@pytest.mark.parametrize("lat, lng", [(None, "0"), ("0", None), ("", "0"), ("   ", "0")])
def test_parse_coordinates_rejects_missing(lat, lng):
    with pytest.raises(InvalidPlaceQueryError, match="obligatorio"):
        validators.parse_coordinates(lat, lng)


@pytest.mark.parametrize("raw", ["nan", "inf", "-inf", "abc", "1,5", "1.2.3"])
def test_parse_coordinates_rejects_non_finite_or_non_numeric(raw):
    with pytest.raises(InvalidPlaceQueryError, match="número"):
        validators.parse_coordinates(raw, "0")


def test_parse_radius_defaults_and_limits():
    assert validators.parse_radius(None) == kinds.DEFAULT_RADIUS_METERS == 5000
    assert validators.parse_radius("") == 5000
    assert validators.parse_radius("250.5") == 250.5
    assert validators.parse_radius(str(kinds.MAX_RADIUS_METERS)) == 50000
    with pytest.raises(InvalidPlaceQueryError):
        validators.parse_radius("50000.1")
    with pytest.raises(InvalidPlaceQueryError):
        validators.parse_radius("0")
    with pytest.raises(InvalidPlaceQueryError):
        validators.parse_radius("-1")


def test_parse_limit_and_offset_bounds():
    assert validators.parse_limit(None) == kinds.DEFAULT_LIMIT
    assert validators.parse_limit("50") == 50
    assert validators.parse_offset(None) == 0
    assert validators.parse_offset("10000") == 10000
    for bad in ("0", "51", "x", "1.5"):
        with pytest.raises(InvalidPlaceQueryError):
            validators.parse_limit(bad)
    for bad in ("-1", "10001", "x"):
        with pytest.raises(InvalidPlaceQueryError):
            validators.parse_offset(bad)


@pytest.mark.parametrize("slug", ["cafes", "centros-comerciales", "a1-b2"])
def test_parse_category_slug_accepts_valid(slug):
    assert validators.parse_category_slug(slug) == slug


@pytest.mark.parametrize("slug", ["Cafes", "con espacio", "-x", "x-", "a--b", "ñandú", "x;y", "a" * 61])
def test_parse_category_slug_rejects_invalid(slug):
    with pytest.raises(InvalidPlaceQueryError):
        validators.parse_category_slug(slug)


def test_parse_category_slug_none_means_no_filter():
    assert validators.parse_category_slug(None) is None
    assert validators.parse_category_slug("  ") is None


def test_documented_values_match_the_adr():
    assert kinds.VERIFICATION_STATUSES == ("pending", "verified", "needs_review", "rejected", "inactive")
    assert kinds.SOURCES == ("thers_field", "business", "community", "osm", "official")
    assert kinds.COORDINATE_SOURCES == ("gps", "map_selected", "geocoded", "imported")
    assert kinds.MAX_RADIUS_METERS == 50000


# --- Casos de uso ----------------------------------------------------------


def test_nearby_use_case_validates_before_touching_the_repository():
    repo = FakeRepository()

    with pytest.raises(InvalidPlaceQueryError):
        place_use_cases.nearby_places("200", "0", None, None, None, repo)

    assert repo.calls == []


def test_nearby_use_case_passes_parsed_values_and_presents_distance():
    repo = FakeRepository(rows=[_row(distance_meters=499.6)])

    places = place_use_cases.nearby_places("13.5", "-89.5", "3000", "cafes", "5", repo)

    assert repo.calls == [("nearby", 13.5, -89.5, 3000.0, "cafes", 5)]
    assert places[0]["distance_meters"] == 500
    assert places[0]["category"] == {"id": "c1", "slug": "cafes", "name": "Cafés"}


def test_use_case_rejects_an_unknown_category():
    repo = FakeRepository(categories=())

    with pytest.raises(InvalidPlaceQueryError, match="Categoría inválida"):
        place_use_cases.list_places("cafes", None, None, repo)


def test_get_place_raises_not_found_when_repository_returns_none():
    with pytest.raises(PlaceNotFoundError):
        place_use_cases.get_place("x", FakeRepository())


def test_detail_presenter_serialises_last_verified_at():
    from datetime import datetime, timezone

    moment = datetime(2026, 10, 8, 12, 0, tzinfo=timezone.utc)
    repo = FakeRepository(rows=[_row(last_verified_at=moment)])

    place = place_use_cases.get_place("p1", repo)

    assert place["last_verified_at"] == "2026-10-08T12:00:00+00:00"
