# Pruebas de guardados de THERS Places (ADR-040, fase 2): guardar, quitar, listar,
# `is_saved`, duplicados, identidad opcional, límite de uso y exportación de datos.

import uuid

import pytest
from sqlalchemy import text

from app.domain.rate_limiting import policy
from app.extensions import db
from tests.places.helpers import REF_LAT, REF_LNG, auth, insert_place, make_users, north_of_reference


def _saved_count(app, user_id=None):
    with app.app_context():
        sql = "SELECT count(*) FROM saved_places"
        if user_id:
            return db.session.execute(text(sql + " WHERE user_id = :u"), {"u": user_id}).scalar()
        return db.session.execute(text(sql)).scalar()


@pytest.fixture()
def setup(app, client):
    users = make_users(app, client)
    with app.app_context():
        place_id = insert_place("Café Aurora", lat=north_of_reference(300), lng=REF_LNG)
    return users, place_id


# --- Guardar y quitar ------------------------------------------------------


def test_save_a_place(client, app, setup):
    users, place_id = setup
    token, user_id = users["ana"]

    response = client.post(f"/api/places/{place_id}/save", headers=auth(token))

    assert response.status_code == 200
    assert response.get_json() == {"saved": True}
    assert _saved_count(app, user_id) == 1


def test_saving_twice_is_idempotent_and_never_duplicates(client, app, setup):
    users, place_id = setup
    token, user_id = users["ana"]

    first = client.post(f"/api/places/{place_id}/save", headers=auth(token))
    second = client.post(f"/api/places/{place_id}/save", headers=auth(token))

    assert first.status_code == second.status_code == 200
    assert _saved_count(app, user_id) == 1


def test_unsave_a_place(client, app, setup):
    users, place_id = setup
    token, user_id = users["ana"]
    client.post(f"/api/places/{place_id}/save", headers=auth(token))

    response = client.delete(f"/api/places/{place_id}/save", headers=auth(token))

    assert response.status_code == 200
    assert response.get_json() == {"saved": False}
    assert _saved_count(app, user_id) == 0


def test_unsaving_twice_is_idempotent(client, setup):
    users, place_id = setup
    token, _ = users["ana"]
    client.post(f"/api/places/{place_id}/save", headers=auth(token))

    first = client.delete(f"/api/places/{place_id}/save", headers=auth(token))
    second = client.delete(f"/api/places/{place_id}/save", headers=auth(token))

    assert first.status_code == second.status_code == 200


def test_saves_are_private_to_each_person(client, app, setup):
    users, place_id = setup
    ana, ana_id = users["ana"]
    beto, beto_id = users["beto"]
    client.post(f"/api/places/{place_id}/save", headers=auth(ana))

    assert _saved_count(app, ana_id) == 1
    assert _saved_count(app, beto_id) == 0
    assert client.get("/api/places/saved", headers=auth(beto)).get_json() == {"places": []}
    # Quitar el "mismo" lugar siendo otra persona no toca el guardado de Ana.
    client.delete(f"/api/places/{place_id}/save", headers=auth(beto))
    assert _saved_count(app, ana_id) == 1


# --- Errores ---------------------------------------------------------------


@pytest.mark.parametrize("method", ["post", "delete"])
def test_save_and_unsave_require_authentication(client, setup, method):
    _, place_id = setup

    response = getattr(client, method)(f"/api/places/{place_id}/save")

    assert response.status_code == 401


def test_saved_list_requires_authentication(client):
    assert client.get("/api/places/saved").status_code == 401


@pytest.mark.parametrize("method", ["post", "delete"])
def test_save_unknown_place_is_404(client, setup, method):
    users, _ = setup

    response = getattr(client, method)(f"/api/places/{uuid.uuid4()}/save", headers=auth(users["ana"][0]))

    assert response.status_code == 404
    assert response.get_json() == {"msg": "Lugar no encontrado"}


@pytest.mark.parametrize("kwargs", [{"status": "pending"}, {"active": False}, {"status": "rejected"}])
def test_cannot_save_a_non_public_place(client, app, setup, kwargs):
    users, _ = setup
    with app.app_context():
        hidden = insert_place("Oculto", **kwargs)

    response = client.post(f"/api/places/{hidden}/save", headers=auth(users["ana"][0]))

    assert response.status_code == 404


def test_cannot_save_with_an_invalid_token(client, setup):
    _, place_id = setup

    response = client.post(f"/api/places/{place_id}/save", headers=auth("token-falso"))

    assert response.status_code in (401, 422)


# --- Lista de guardados ----------------------------------------------------


def test_saved_list_is_newest_first_and_marks_is_saved(client, app, setup):
    users, first_id = setup
    token, _ = users["ana"]
    with app.app_context():
        second_id = insert_place("Segundo lugar")
    client.post(f"/api/places/{first_id}/save", headers=auth(token))
    client.post(f"/api/places/{second_id}/save", headers=auth(token))

    places = client.get("/api/places/saved", headers=auth(token)).get_json()["places"]

    assert [p["name"] for p in places] == ["Segundo lugar", "Café Aurora"]
    assert all(p["is_saved"] is True for p in places)
    assert "distance_meters" not in places[0]


def test_saved_list_hides_places_that_stopped_being_public(client, app, setup):
    users, place_id = setup
    token, _ = users["ana"]
    client.post(f"/api/places/{place_id}/save", headers=auth(token))
    with app.app_context():
        db.session.execute(text("UPDATE places SET is_active = false WHERE id = :id"), {"id": place_id})
        db.session.commit()

    assert client.get("/api/places/saved", headers=auth(token)).get_json() == {"places": []}
    # El guardado sigue existiendo, y se puede quitar aunque el lugar ya no sea público.
    assert client.delete(f"/api/places/{place_id}/save", headers=auth(token)).status_code == 200


def test_saved_list_paginates_and_validates(client, app, setup):
    users, place_id = setup
    token, _ = users["ana"]
    client.post(f"/api/places/{place_id}/save", headers=auth(token))

    assert len(client.get("/api/places/saved?limit=1", headers=auth(token)).get_json()["places"]) == 1
    assert client.get("/api/places/saved?offset=5", headers=auth(token)).get_json() == {"places": []}
    assert client.get("/api/places/saved?limit=99", headers=auth(token)).status_code == 400


# --- is_saved en el catálogo público --------------------------------------


def test_is_saved_is_false_for_anonymous_visitors(client, setup):
    _, place_id = setup

    assert client.get(f"/api/places/{place_id}").get_json()["place"]["is_saved"] is False
    assert client.get("/api/places").get_json()["places"][0]["is_saved"] is False


def test_is_saved_reflects_the_signed_in_person_in_every_public_endpoint(client, setup):
    users, place_id = setup
    ana, _ = users["ana"]
    beto, _ = users["beto"]
    client.post(f"/api/places/{place_id}/save", headers=auth(ana))
    nearby = f"/api/places/nearby?lat={REF_LAT}&lng={REF_LNG}"

    for url in ("/api/places", nearby, "/api/places/search?q=aurora"):
        assert client.get(url, headers=auth(ana)).get_json()["places"][0]["is_saved"] is True
        assert client.get(url, headers=auth(beto)).get_json()["places"][0]["is_saved"] is False
    assert client.get(f"/api/places/{place_id}", headers=auth(ana)).get_json()["place"]["is_saved"] is True


def test_an_invalid_or_expired_token_is_treated_as_anonymous_not_as_an_error(client, setup):
    _, place_id = setup

    for header in ({"Authorization": "Bearer basura"}, {"Authorization": "Bearer a.b.c"}, {"Authorization": "nada"}):
        response = client.get(f"/api/places/{place_id}", headers=header)
        assert response.status_code == 200
        assert response.get_json()["place"]["is_saved"] is False


def test_a_logged_out_token_stops_marking_saves(client, setup):
    users, place_id = setup
    token, _ = users["ana"]
    client.post(f"/api/places/{place_id}/save", headers=auth(token))
    client.post("/api/logout", headers=auth(token))  # puede o no revocar el access token

    response = client.get(f"/api/places/{place_id}", headers=auth(token))

    assert response.status_code == 200  # nunca un error en una ruta pública


# --- Límite de uso y datos personales --------------------------------------


def test_saving_is_rate_limited_per_account(client, setup):
    users, place_id = setup
    ana, _ = users["ana"]
    beto, _ = users["beto"]

    for _ in range(policy.PLACES_SAVE.limit):
        assert client.post(f"/api/places/{place_id}/save", headers=auth(ana)).status_code == 200
    limited = client.post(f"/api/places/{place_id}/save", headers=auth(ana))

    assert limited.status_code == 429
    assert "Retry-After" in limited.headers
    # Otra cuenta no se ve afectada.
    assert client.post(f"/api/places/{place_id}/save", headers=auth(beto)).status_code == 200


def test_deleting_the_account_removes_the_saved_places(client, app, setup):
    users, place_id = setup
    token, user_id = users["ana"]
    client.post(f"/api/places/{place_id}/save", headers=auth(token))

    with app.app_context():
        db.session.execute(text("DELETE FROM users WHERE id = :u"), {"u": user_id})
        db.session.commit()

    assert _saved_count(app) == 0
    with app.app_context():  # el lugar sigue ahí
        assert db.session.execute(text("SELECT count(*) FROM places")).scalar() == 1


def test_data_export_includes_saved_places(client, app, setup):
    from app.infrastructure.persistence.repositories.data_export_repository import (
        SQLAlchemyDataExportRepository,
    )

    users, place_id = setup
    token, user_id = users["ana"]
    client.post(f"/api/places/{place_id}/save", headers=auth(token))

    with app.app_context():
        data = SQLAlchemyDataExportRepository().collect_user_data(user_id)

    assert [s["place"] for s in data["saved_places"]] == ["Café Aurora"]
    assert data["place_reports"] == []
