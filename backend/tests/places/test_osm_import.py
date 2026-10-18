# Pruebas de la importación de OpenStreetMap (ADR-043): traducción de etiquetas (pura), el estado
# `unverified` en la lectura pública, y que reimportar sea idempotente y no pise lo que ya cambió.

import importlib.util
import os

import pytest
from sqlalchemy import text

from app.domain.places import kinds, osm_mapping
from app.extensions import db
from tests.places.helpers import REF_LAT, REF_LNG, insert_place


def _node(osm_id=1, name="Farmacia Económica", tags=None, lat=REF_LAT, lng=REF_LNG):
    return {
        "type": "node",
        "id": osm_id,
        "lat": lat,
        "lon": lng,
        "tags": {"name": name, "amenity": "pharmacy", **(tags or {})},
    }


# --- Traducción pura ---


@pytest.mark.parametrize(
    "tags, expected",
    [
        ({"amenity": "cafe"}, "cafes"),
        ({"amenity": "fast_food"}, "restaurantes"),
        ({"amenity": "bar"}, "entretenimiento"),
        ({"amenity": "fuel"}, "gasolineras"),
        ({"amenity": "hospital"}, "hospitales"),
        ({"amenity": "place_of_worship"}, "otros"),
        ({"shop": "supermarket"}, "supermercados"),
        ({"shop": "mall"}, "centros-comerciales"),
        ({"shop": "bakery"}, "otros"),
        ({"tourism": "hostel"}, "hoteles"),
        ({"leisure": "park"}, "parques"),
        ({"amenity": "university"}, "universidades"),
    ],
)
def test_known_tags_map_to_a_category(tags, expected):
    assert osm_mapping.category_for(tags) == expected


@pytest.mark.parametrize(
    "tags",
    [{}, {"amenity": "bench"}, {"shop": "vacant"}, {"shop": "yes"}, {"leisure": "pitch"}, {"highway": "bus_stop"}],
)
def test_unknown_or_noise_tags_are_not_imported(tags):
    assert osm_mapping.category_for(tags) is None


def test_a_valid_node_becomes_a_place():
    place = osm_mapping.place_from_element(
        _node(7, "Café Ñandú", {"amenity": "cafe", "addr:street": "Calle 1", "addr:housenumber": "12",
                                "addr:city": "San Salvador", "website": "https://ejemplo.sv"})
    )

    assert place["osm_type"] == "node" and place["osm_id"] == 7
    assert place["category"] == "cafes"
    assert place["address"] == "Calle 1 12, San Salvador"
    assert place["website"] == "https://ejemplo.sv"
    assert "phone" not in place  # puede ser el de un particular (ADR-040 R6)


def test_a_way_uses_its_center():
    element = {"type": "way", "id": 9, "center": {"lat": 13.7, "lon": -89.2},
               "tags": {"name": "Parque Cuscatlán", "leisure": "park"}}

    place = osm_mapping.place_from_element(element)

    assert (place["latitude"], place["longitude"]) == (13.7, -89.2)


@pytest.mark.parametrize(
    "element",
    [
        _node(name=""),
        {**_node(), "tags": {"amenity": "pharmacy"}},  # sin nombre
        {**_node(), "id": 0},
        {**_node(), "id": "5"},
        {**_node(), "type": "area"},
        _node(lat=40.0, lng=-3.7),  # fuera de El Salvador
        {"type": "way", "id": 3, "tags": {"name": "Sin centro", "leisure": "park"}},
        {**_node(), "lat": "13.7"},
    ],
)
def test_invalid_elements_are_skipped(element):
    assert osm_mapping.place_from_element(element) is None


def test_text_is_cleaned_and_websites_must_be_http():
    assert osm_mapping.clean_text("  Hola\n\tmundo\x00  ", 50) == "Hola mundo"
    assert osm_mapping.clean_text("x" * 300, 160) == "x" * 160
    assert osm_mapping.clean_website("javascript:alert(1)") is None
    assert osm_mapping.clean_website("ftp://a.sv") is None
    assert osm_mapping.clean_website("http://a.sv/x") == "http://a.sv/x"
    assert osm_mapping.clean_website("https://a.sv/" + "x" * 300) is None


def test_the_unverified_status_is_public_but_not_trusted():
    assert kinds.STATUS_UNVERIFIED in kinds.VERIFICATION_STATUSES
    assert kinds.PUBLIC_STATUSES == ("verified", "unverified")


# --- Importador ---


def _load_importer():
    path = os.path.join(os.path.dirname(__file__), "..", "..", "scripts", "import_osm_places.py")
    spec = importlib.util.spec_from_file_location("import_osm_places", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_build_rows_dedupes_by_osm_reference_and_builds_unique_slugs():
    importer = _load_importer()
    payloads = [{"elements": [_node(1), _node(2), _node(1), _node(3, name="")]},
                {"elements": [_node(2)]}]

    rows, skipped = importer.build_rows(payloads)

    assert [r["osm_id"] for r in rows] == [1, 2]
    assert skipped == 1
    assert len({r["slug"] for r in rows}) == 2
    assert rows[0]["slug"] == "farmacia-economica-n1"


def _import(app, elements):
    importer = _load_importer()
    rows, _ = importer.build_rows([{"elements": elements}])
    with app.app_context():
        importer.save(rows)


def _place(app, osm_id):
    with app.app_context():
        return db.session.execute(
            text("SELECT id, name, verification_status, source, is_active FROM places WHERE osm_id = :i"),
            {"i": osm_id},
        ).mappings().first()


def test_import_creates_unverified_osm_places_and_is_idempotent(app):
    _import(app, [_node(101, "Farmacia Uno")])
    _import(app, [_node(101, "Farmacia Uno")])

    with app.app_context():
        count = db.session.execute(text("SELECT count(*) FROM places WHERE osm_id = 101")).scalar()
    row = _place(app, 101)
    assert count == 1
    assert (row["verification_status"], row["source"], row["is_active"]) == ("unverified", "osm", True)


def test_reimport_refreshes_an_untouched_place(app):
    _import(app, [_node(102, "Nombre viejo")])
    _import(app, [_node(102, "Nombre nuevo")])

    assert _place(app, 102)["name"] == "Nombre nuevo"


@pytest.mark.parametrize("change", ["verified", "inactive", "rejected"])
def test_reimport_never_overwrites_a_place_someone_already_moderated(app, change):
    _import(app, [_node(103, "Nombre original")])
    with app.app_context():
        db.session.execute(
            text("UPDATE places SET verification_status = :s WHERE osm_id = 103"), {"s": change}
        )
        db.session.commit()

    _import(app, [_node(103, "Nombre de OSM")])

    row = _place(app, 103)
    assert row["name"] == "Nombre original"
    assert row["verification_status"] == change


def test_the_database_rejects_a_bad_osm_type_and_a_duplicate_reference(app):
    _import(app, [_node(104)])
    with app.app_context():
        with pytest.raises(Exception):
            db.session.execute(text("UPDATE places SET osm_type = 'area' WHERE osm_id = 104"))
            db.session.commit()
        db.session.rollback()
    with app.app_context():
        with pytest.raises(Exception):
            insert_place("Duplicado", slug="dup-104", source="osm")
            db.session.execute(text("UPDATE places SET osm_type='node', osm_id=104 WHERE slug='dup-104'"))
            db.session.commit()
        db.session.rollback()


# --- Lectura pública ---


def test_unverified_places_are_listed_searched_and_labelled(client, app):
    with app.app_context():
        insert_place("Panadería Sin Verificar", status="unverified", source="osm")
        insert_place("Panadería Pendiente", status="pending")

    found = client.get("/api/places/search", query_string={"q": "panaderia"}).get_json()["places"]
    nearby = client.get(
        "/api/places/nearby", query_string={"lat": REF_LAT, "lng": REF_LNG, "radius": 1000}
    ).get_json()["places"]

    assert [(p["name"], p["verification_status"]) for p in found] == [("Panadería Sin Verificar", "unverified")]
    assert "Panadería Sin Verificar" in [p["name"] for p in nearby]
    assert "Panadería Pendiente" not in [p["name"] for p in nearby]


def test_an_unverified_place_has_a_public_detail_page(client, app):
    with app.app_context():
        place_id = insert_place("Tienda OSM", status="unverified", source="osm")

    response = client.get(f"/api/places/{place_id}")

    assert response.status_code == 200
    body = response.get_json()
    place = body.get("place", body)
    assert place["verification_status"] == "unverified" and place["source"] == "osm"
