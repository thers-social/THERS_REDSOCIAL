# Pruebas del esquema de THERS Places (ADR-040, fase 1): restricciones, tipo
# geográfico e índice espacial, contra PostgreSQL + PostGIS reales.

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.extensions import db
from tests.places.helpers import insert_place


def test_postgis_extension_is_available(app):
    with app.app_context():
        version = db.session.execute(text("SELECT postgis_version()")).scalar()

    assert version.startswith("3.")


def test_location_is_stored_as_geography_point_4326(app):
    with app.app_context():
        place_id = insert_place("Punto", lat=13.5, lng=-89.25)
        row = db.session.execute(
            text(
                "SELECT ST_SRID(location::geometry), GeometryType(location::geometry), "
                "ST_Y(location::geometry), ST_X(location::geometry) "
                "FROM places WHERE id = :id"
            ),
            {"id": place_id},
        ).one()

    assert row[0] == 4326
    assert row[1] == "POINT"
    assert row[2] == pytest.approx(13.5)
    assert row[3] == pytest.approx(-89.25)


def test_spatial_gist_index_exists_on_location(app):
    with app.app_context():
        definition = db.session.execute(
            text("SELECT indexdef FROM pg_indexes WHERE indexname = 'ix_places_location'")
        ).scalar()

    assert definition is not None
    assert "USING gist" in definition


def test_slug_must_be_unique(app):
    with app.app_context():
        insert_place("Uno", slug="mismo-slug")
        with pytest.raises(IntegrityError):
            insert_place("Dos", slug="mismo-slug")
        db.session.rollback()


@pytest.mark.parametrize(
    "field, value",
    [
        ("status", "borrador"),
        ("source", "google"),
        ("coordinate_source", "adivinadas"),
    ],
)
def test_check_constraints_reject_unknown_values(app, field, value):
    with app.app_context():
        with pytest.raises(IntegrityError):
            insert_place("Inválido", **{field: value})
        db.session.rollback()


@pytest.mark.parametrize("status", ["pending", "verified", "needs_review", "rejected", "inactive"])
def test_every_documented_status_is_accepted(app, status):
    with app.app_context():
        insert_place(f"Estado {status}", status=status)


@pytest.mark.parametrize("source", ["thers_field", "business", "community", "osm", "official"])
def test_every_documented_source_is_accepted(app, source):
    with app.app_context():
        insert_place(f"Fuente {source}", source=source)


@pytest.mark.parametrize("coordinate_source", ["gps", "map_selected", "geocoded", "imported"])
def test_every_documented_coordinate_source_is_accepted(app, coordinate_source):
    with app.app_context():
        insert_place(f"Coord {coordinate_source}", coordinate_source=coordinate_source)


def test_postgis_silently_coerces_out_of_range_coordinates(app):
    # HALLAZGO (ADR-040 §4.2): `geography` NO rechaza una latitud de 95; la guarda como
    # 85 (y una longitud de 190 como -170) sin error. Ninguna restricción de la base puede
    # detectarlo, porque el valor ya llega "corregido". Por eso TODA escritura de
    # coordenadas (la administración de la fase 2, importaciones) debe pasar antes por
    # `validators.parse_coordinates`. Si una versión futura de PostGIS cambiara esto,
    # esta prueba fallará y habrá que revisar el ADR.
    with app.app_context():
        place_id = insert_place("Fuera de rango", lat=95, lng=190)
        lat, lng = db.session.execute(
            text("SELECT ST_Y(location::geometry), ST_X(location::geometry) FROM places WHERE id = :id"),
            {"id": place_id},
        ).one()

    assert (lat, lng) == (pytest.approx(85), pytest.approx(-170))


def test_a_category_in_use_cannot_be_deleted(app):
    with app.app_context():
        insert_place("Con categoría", category="cafes")
        with pytest.raises(IntegrityError):
            db.session.execute(text("DELETE FROM place_categories WHERE slug = 'cafes'"))
        db.session.rollback()


def test_new_places_default_to_pending_and_active(app):
    with app.app_context():
        db.session.execute(
            text(
                "INSERT INTO places (name, slug, category_id, location, source, coordinate_source) "
                "SELECT 'Sin estado', 'sin-estado', id, "
                "ST_SetSRID(ST_MakePoint(0, 0), 4326)::geography, 'community', 'gps' "
                "FROM place_categories WHERE slug = 'otros'"
            )
        )
        db.session.commit()
        status, active = db.session.execute(
            text("SELECT verification_status, is_active FROM places WHERE slug = 'sin-estado'")
        ).one()

    assert status == "pending"
    assert active is True


def test_creator_reference_is_cleared_when_the_user_is_deleted(app, client):
    # SET NULL: si quien creó el lugar elimina su cuenta, el lugar sigue (ADR-040 §4.2).
    with app.app_context():
        user_id = db.session.execute(
            text(
                "INSERT INTO users (name, username, email, password_hash) "
                "VALUES ('Creador', 'creador', 'creador@example.com', 'x') RETURNING id"
            )
        ).scalar()
        place_id = insert_place("Del creador")
        db.session.execute(
            text("UPDATE places SET created_by_user_id = :u WHERE id = :p"),
            {"u": user_id, "p": place_id},
        )
        db.session.commit()

        db.session.execute(text("DELETE FROM users WHERE id = :u"), {"u": user_id})
        db.session.commit()
        created_by = db.session.execute(
            text("SELECT created_by_user_id FROM places WHERE id = :p"), {"p": place_id}
        ).scalar()

    assert created_by is None
