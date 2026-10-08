# Pruebas de la moderación de THERS Places (ADR-040, fase 2; D3: se reutiliza
# `is_moderator` y el 404 para quien no lo es): crear, editar, cambiar estado, cola de
# reportes, auditoría y permisos.

import uuid

import pytest
from sqlalchemy import text

from app.extensions import db
from tests.places.helpers import auth, insert_place, make_users

BASE = "/api/moderation/places"
NOT_FOUND = {"msg": "Recurso no encontrado"}

NEW_PLACE = {
    "name": "Café Nuevo",
    "category": "cafes",
    "latitude": 13.7,
    "longitude": -89.2,
    "address": "Calle 1",
}


@pytest.fixture()
def world(app, client):
    users = make_users(app, client, with_moderator=True)
    with app.app_context():
        place_id = insert_place("Café Aurora")
    return users, place_id


def _mod(users):
    return auth(users["mod"][0])


def _audit(app, action=None):
    with app.app_context():
        sql = "SELECT action, resource_type, changes, actor_id::text FROM admin_audit_log"
        params = {}
        if action:
            sql += " WHERE action = :a"
            params["a"] = action
        return db.session.execute(text(sql + " ORDER BY created_at"), params).all()


# --- Permisos: solo moderadores; el resto recibe el 404 de una ruta inexistente ----


ENDPOINTS = [
    ("get", BASE), ("post", BASE), ("get", f"{BASE}/summary"), ("get", f"{BASE}/reports"),
    ("get", f"{BASE}/{uuid.uuid4()}"), ("patch", f"{BASE}/{uuid.uuid4()}"),
    ("patch", f"{BASE}/{uuid.uuid4()}/status"),
    ("post", f"{BASE}/reports/{uuid.uuid4()}/resolve"),
]


@pytest.mark.parametrize("method, url", ENDPOINTS)
def test_a_normal_user_gets_the_same_404_as_a_missing_route(client, world, method, url):
    users, _ = world

    response = getattr(client, method)(url, json={}, headers=auth(users["ana"][0]))

    assert response.status_code == 404
    assert response.get_json() == NOT_FOUND


@pytest.mark.parametrize("method, url", ENDPOINTS)
def test_without_a_token_the_moderation_routes_require_login(client, method, url):
    assert getattr(client, method)(url, json={}).status_code == 401


def test_a_suspended_moderator_loses_access(client, app, world):
    users, _ = world
    with app.app_context():
        db.session.execute(text("UPDATE users SET suspended_at = now() WHERE is_moderator"))
        db.session.commit()

    assert client.get(BASE, headers=_mod(users)).status_code == 404


def test_a_normal_user_cannot_change_anything(client, app, world):
    users, place_id = world
    ana = auth(users["ana"][0])

    client.post(BASE, json=NEW_PLACE, headers=ana)
    client.patch(f"{BASE}/{place_id}", json={"name": "Hackeado"}, headers=ana)
    client.patch(f"{BASE}/{place_id}/status", json={"verification_status": "rejected"}, headers=ana)

    with app.app_context():
        assert db.session.execute(text("SELECT count(*) FROM places")).scalar() == 1
        assert db.session.execute(text("SELECT name, verification_status FROM places")).one() == (
            "Café Aurora", "verified",
        )
    assert _audit(app) == []


# --- Crear -----------------------------------------------------------------


def test_create_a_place(client, app, world):
    users, _ = world

    response = client.post(BASE, json=NEW_PLACE, headers=_mod(users))

    assert response.status_code == 201
    place = response.get_json()["place"]
    assert place["name"] == "Café Nuevo"
    assert place["verification_status"] == "pending"  # nace sin verificar, nunca público
    assert place["is_active"] is True
    assert place["slug"] == "cafe-nuevo"
    assert place["latitude"] == pytest.approx(13.7)
    assert place["source"] == "thers_field" and place["coordinate_source"] == "map_selected"
    assert place["created_by_user_id"] == users["mod"][1]
    # Un lugar recién creado no aparece en el catálogo público hasta que se verifique.
    assert client.get(f"/api/places/{place['id']}").status_code == 404
    assert [(a, r) for a, r, _, _ in _audit(app)] == [("place_created", "place")]


def test_create_generates_unique_slugs_for_the_same_name(client, world):
    users, _ = world

    slugs = [client.post(BASE, json=NEW_PLACE, headers=_mod(users)).get_json()["place"]["slug"] for _ in range(3)]

    assert len(set(slugs)) == 3
    assert slugs[0] == "cafe-nuevo" and slugs[1].startswith("cafe-nuevo-")


def test_create_slug_handles_accents_and_symbols(client, world):
    users, _ = world

    place = client.post(
        BASE, json={**NEW_PLACE, "name": "¡Ñandú & Co.! Pupusería"}, headers=_mod(users)
    ).get_json()["place"]

    assert place["slug"] == "nandu-co-pupuseria"


@pytest.mark.parametrize(
    "change, fragment",
    [
        ({"name": ""}, "name es obligatorio"),
        ({"name": None}, "name es obligatorio"),
        ({"name": "x" * 161}, "name no puede superar 160"),
        ({"name": 123}, "name debe ser texto"),
        ({"name": "Con\nsalto"}, "saltos de línea"),
        ({"category": "inventada"}, "Categoría inválida"),
        ({"category": ""}, "category es obligatorio"),
        ({"latitude": 91}, "latitude debe estar entre -90 y 90"),
        ({"latitude": -91}, "latitude debe estar entre -90 y 90"),
        ({"longitude": 181}, "longitude debe estar entre -180 y 180"),
        ({"latitude": None}, "latitude es obligatorio"),
        ({"latitude": "abc"}, "latitude debe ser un número"),
        ({"latitude": True}, "latitude debe ser un número"),
        ({"phone": "abc"}, "phone no tiene un formato válido"),
        ({"phone": "12"}, "phone no tiene un formato válido"),
        ({"website": "ftp://x.com"}, "website debe empezar con http"),
        ({"website": "javascript:alert(1)"}, "website debe empezar con http"),
        ({"website": "https://a b.com"}, "website debe empezar con http"),
        ({"website": "https://" + "a" * 250}, "website no puede superar 255"),
        ({"description": "x" * 2001}, "description no puede superar 2000"),
        ({"source": "google"}, "source inválido"),
        ({"coordinate_source": "adivinadas"}, "coordinate_source inválido"),
    ],
)
def test_create_rejects_invalid_data(client, app, world, change, fragment):
    users, _ = world

    response = client.post(BASE, json={**NEW_PLACE, **change}, headers=_mod(users))

    assert response.status_code == 400
    assert fragment in response.get_json()["msg"]
    with app.app_context():
        assert db.session.execute(text("SELECT count(*) FROM places")).scalar() == 1
    assert _audit(app) == []


def test_create_rejects_a_body_that_is_not_a_json_object(client, world):
    users, _ = world

    assert client.post(BASE, data="x", headers=_mod(users)).status_code == 400
    assert client.post(BASE, json=[1, 2], headers=_mod(users)).status_code == 400


def test_create_ignores_forged_internal_fields(client, world):
    users, _ = world

    place = client.post(
        BASE,
        json={**NEW_PLACE, "verification_status": "verified", "is_active": False,
              "created_by_user_id": str(uuid.uuid4()), "verified_by_user_id": str(uuid.uuid4())},
        headers=_mod(users),
    ).get_json()["place"]

    assert place["verification_status"] == "pending"
    assert place["is_active"] is True
    assert place["created_by_user_id"] == users["mod"][1]
    assert place["verified_by_user_id"] is None


def test_create_does_not_store_out_of_range_coordinates_silently(client, app, world):
    # PostGIS corregiría 95 -> 85 sin avisar; la API debe rechazarlo ANTES (hallazgo fase 1).
    users, _ = world

    response = client.post(BASE, json={**NEW_PLACE, "latitude": 95}, headers=_mod(users))

    assert response.status_code == 400
    with app.app_context():
        assert db.session.execute(text("SELECT count(*) FROM places")).scalar() == 1


# --- Editar ----------------------------------------------------------------


def test_edit_a_place_and_audit_before_and_after(client, app, world):
    users, place_id = world

    response = client.patch(
        f"{BASE}/{place_id}",
        json={"name": "Café Aurora Norte", "phone": "+503 2222-9999", "latitude": 13.8, "longitude": -89.3},
        headers=_mod(users),
    )

    assert response.status_code == 200
    place = response.get_json()["place"]
    assert place["name"] == "Café Aurora Norte"
    assert place["phone"] == "+503 2222-9999"
    assert (place["latitude"], place["longitude"]) == (pytest.approx(13.8), pytest.approx(-89.3))
    assert place["slug"].startswith("test-place-")  # el slug no cambia al renombrar
    action, resource, changes, actor = _audit(app)[0]
    assert (action, resource, actor) == ("place_updated", "place", users["mod"][1])
    assert changes["name"] == ["Café Aurora", "Café Aurora Norte"]
    assert changes["phone"] == [None, "+503 2222-9999"]
    assert changes["location"][1] == [13.8, -89.3]


def test_edit_changes_the_category(client, world):
    users, place_id = world

    place = client.patch(f"{BASE}/{place_id}", json={"category": "parques"}, headers=_mod(users)).get_json()["place"]

    assert place["category"]["slug"] == "parques"


def test_edit_can_clear_an_optional_field(client, world):
    users, place_id = world
    client.patch(f"{BASE}/{place_id}", json={"phone": "2222-3333"}, headers=_mod(users))

    place = client.patch(f"{BASE}/{place_id}", json={"phone": None}, headers=_mod(users)).get_json()["place"]

    assert place["phone"] is None


def test_edit_with_no_real_change_writes_no_audit_entry(client, app, world):
    users, place_id = world

    response = client.patch(f"{BASE}/{place_id}", json={"name": "Café Aurora"}, headers=_mod(users))

    assert response.status_code == 200
    assert _audit(app) == []


@pytest.mark.parametrize(
    "body, fragment",
    [
        ({}, "No se enviaron campos"),
        ({"campo_desconocido": 1}, "No se enviaron campos"),
        ({"name": ""}, "name es obligatorio"),
        ({"latitude": 13.7}, "longitude es obligatorio"),
        ({"longitude": -89.2}, "latitude es obligatorio"),
        ({"latitude": 100, "longitude": 0}, "latitude debe estar entre"),
        ({"category": "inventada"}, "Categoría inválida"),
        ({"website": "http://"}, "website debe empezar con http"),
    ],
)
def test_edit_rejects_invalid_data(client, app, world, body, fragment):
    users, place_id = world

    response = client.patch(f"{BASE}/{place_id}", json=body, headers=_mod(users))

    assert response.status_code == 400
    assert fragment in response.get_json()["msg"]
    assert _audit(app) == []


def test_edit_cannot_change_the_status(client, world):
    users, place_id = world

    response = client.patch(
        f"{BASE}/{place_id}", json={"verification_status": "rejected", "is_active": False}, headers=_mod(users)
    )

    assert response.status_code == 400  # ningún campo editable
    assert client.get(f"/api/places/{place_id}").status_code == 200


def test_edit_unknown_place_is_404(client, world):
    users, _ = world

    response = client.patch(f"{BASE}/{uuid.uuid4()}", json={"name": "X"}, headers=_mod(users))

    assert response.status_code == 404
    assert response.get_json() == {"msg": "Lugar no encontrado"}


# --- Cambiar estado --------------------------------------------------------


def test_verify_a_place_makes_it_public_and_records_who_and_when(client, app, world):
    users, _ = world
    created = client.post(BASE, json=NEW_PLACE, headers=_mod(users)).get_json()["place"]

    place = client.patch(
        f"{BASE}/{created['id']}/status", json={"verification_status": "verified"}, headers=_mod(users)
    ).get_json()["place"]

    assert place["verification_status"] == "verified"
    assert place["verified_by_user_id"] == users["mod"][1]
    assert place["last_verified_at"] is not None
    assert client.get(f"/api/places/{created['id']}").status_code == 200
    changed = _audit(app, "place_status_changed")
    assert changed[0][2]["verification_status"] == ["pending", "verified"]


@pytest.mark.parametrize("status", ["rejected", "needs_review", "inactive", "pending"])
def test_moving_a_public_place_out_of_verified_hides_it(client, world, status):
    users, place_id = world

    client.patch(f"{BASE}/{place_id}/status", json={"verification_status": status}, headers=_mod(users))

    assert client.get(f"/api/places/{place_id}").status_code == 404
    assert client.get("/api/places").get_json() == {"places": []}


def test_deactivate_and_reactivate(client, world):
    users, place_id = world

    off = client.patch(f"{BASE}/{place_id}/status", json={"is_active": False}, headers=_mod(users))
    assert off.get_json()["place"]["is_active"] is False
    assert client.get(f"/api/places/{place_id}").status_code == 404

    client.patch(f"{BASE}/{place_id}/status", json={"is_active": True}, headers=_mod(users))
    assert client.get(f"/api/places/{place_id}").status_code == 200


@pytest.mark.parametrize(
    "body, fragment",
    [
        ({}, "Indica verification_status o is_active"),
        ({"verification_status": "borrador"}, "verification_status inválido"),
        ({"verification_status": None}, "verification_status inválido"),
        ({"is_active": "si"}, "is_active debe ser verdadero o falso"),
        ({"is_active": 1}, "is_active debe ser verdadero o falso"),
    ],
)
def test_status_rejects_invalid_values(client, app, world, body, fragment):
    users, place_id = world

    response = client.patch(f"{BASE}/{place_id}/status", json=body, headers=_mod(users))

    assert response.status_code == 400
    assert fragment in response.get_json()["msg"]
    assert _audit(app) == []


def test_status_unknown_place_is_404(client, world):
    users, _ = world

    response = client.patch(
        f"{BASE}/{uuid.uuid4()}/status", json={"verification_status": "verified"}, headers=_mod(users)
    )

    assert response.status_code == 404


# --- Listado, detalle y resumen -------------------------------------------


def test_moderators_see_every_status_unlike_the_public(client, app, world):
    users, _ = world
    with app.app_context():
        insert_place("Pendiente", status="pending")
        insert_place("Inactivo", active=False)

    names = [p["name"] for p in client.get(BASE, headers=_mod(users)).get_json()["places"]]

    assert sorted(names) == ["Café Aurora", "Inactivo", "Pendiente"]
    assert len(client.get("/api/places").get_json()["places"]) == 1


def test_moderation_list_filters_and_paginates(client, app, world):
    users, _ = world
    with app.app_context():
        for i in range(3):
            insert_place(f"Pendiente {i}", status="pending")

    pending = client.get(f"{BASE}?status=pending&limit=2", headers=_mod(users)).get_json()
    by_text = client.get(f"{BASE}?q=aurora", headers=_mod(users)).get_json()

    assert len(pending["places"]) == 2 and pending["has_more"] is True
    assert [p["name"] for p in by_text["places"]] == ["Café Aurora"]
    assert client.get(f"{BASE}?status=raro", headers=_mod(users)).status_code == 400


def test_moderation_detail_exposes_internal_fields(client, world):
    users, place_id = world

    place = client.get(f"{BASE}/{place_id}", headers=_mod(users)).get_json()["place"]

    assert {"is_active", "created_at", "updated_at", "created_by_user_id", "verified_by_user_id"} <= set(place)
    assert "is_saved" not in place
    assert client.get(f"{BASE}/{uuid.uuid4()}", headers=_mod(users)).status_code == 404


def test_summary_counts_places_and_open_reports(client, app, world):
    users, place_id = world
    with app.app_context():
        insert_place("Pendiente", status="pending")
        insert_place("Inactivo", active=False)
    client.post(f"/api/places/{place_id}/report", json={"reason": "closed"}, headers=auth(users["ana"][0]))

    summary = client.get(f"{BASE}/summary", headers=_mod(users)).get_json()["summary"]

    assert summary["places_by_status"] == {
        "pending": 1, "verified": 2, "needs_review": 0, "rejected": 0, "inactive": 0,
    }
    assert summary["places_inactive"] == 1
    assert summary["open_reports"] == 1


# --- Cola de reportes ------------------------------------------------------


def _report_id(client, users, place_id, reason="closed", who="ana"):
    return client.post(
        f"/api/places/{place_id}/report", json={"reason": reason, "details": "d"}, headers=auth(users[who][0])
    ).get_json()["report"]["id"]


def test_report_queue_lists_open_reports_oldest_first_without_the_reporter(client, world):
    users, place_id = world
    first = _report_id(client, users, place_id, "closed")
    second = _report_id(client, users, place_id, "wrong_name", who="beto")

    body = client.get(f"{BASE}/reports", headers=_mod(users)).get_json()

    assert [r["id"] for r in body["reports"]] == [first, second]
    assert body["has_more"] is False
    report = body["reports"][0]
    assert report["place"]["name"] == "Café Aurora" and report["reason"] == "closed"
    assert "reporter_id" not in report and "reporter" not in report


def test_report_queue_filters_by_status_and_validates(client, world):
    users, place_id = world
    report_id = _report_id(client, users, place_id)
    client.post(f"{BASE}/reports/{report_id}/resolve", json={"status": "resolved"}, headers=_mod(users))

    assert client.get(f"{BASE}/reports", headers=_mod(users)).get_json()["reports"] == []
    resolved = client.get(f"{BASE}/reports?status=resolved", headers=_mod(users)).get_json()["reports"]
    assert [r["id"] for r in resolved] == [report_id]
    assert client.get(f"{BASE}/reports?status=raro", headers=_mod(users)).status_code == 400
    assert client.get(f"{BASE}/reports?limit=0", headers=_mod(users)).status_code == 400


@pytest.mark.parametrize("status", ["resolved", "dismissed"])
def test_resolve_a_report_and_audit_it(client, app, world, status):
    users, place_id = world
    report_id = _report_id(client, users, place_id)

    response = client.post(
        f"{BASE}/reports/{report_id}/resolve",
        json={"status": status, "note": "Revisado en sitio"},
        headers=_mod(users),
    )

    assert response.status_code == 200
    report = response.get_json()["report"]
    assert (report["status"], report["resolution_note"]) == (status, "Revisado en sitio")
    assert report["resolved_at"] is not None
    action, resource, changes, actor = _audit(app, "place_report_resolved")[0]
    assert (resource, actor, changes["status"]) == ("place_report", users["mod"][1], status)


def test_resolving_twice_is_a_409_and_does_not_audit_again(client, app, world):
    users, place_id = world
    report_id = _report_id(client, users, place_id)
    url = f"{BASE}/reports/{report_id}/resolve"
    client.post(url, json={"status": "resolved"}, headers=_mod(users))

    again = client.post(url, json={"status": "dismissed"}, headers=_mod(users))

    assert again.status_code == 409
    assert len(_audit(app, "place_report_resolved")) == 1


@pytest.mark.parametrize(
    "body, fragment",
    [
        ({}, "status debe ser resolved o dismissed"),
        ({"status": "open"}, "status debe ser resolved o dismissed"),
        ({"status": "otro"}, "status debe ser resolved o dismissed"),
        ({"status": "resolved", "note": "x" * 501}, "note no puede superar 500"),
        ({"status": "resolved", "note": 7}, "note debe ser texto"),
    ],
)
def test_resolve_rejects_invalid_input(client, world, body, fragment):
    users, place_id = world
    report_id = _report_id(client, users, place_id)

    response = client.post(f"{BASE}/reports/{report_id}/resolve", json=body, headers=_mod(users))

    assert response.status_code == 400
    assert fragment in response.get_json()["msg"]


def test_resolve_unknown_report_is_404(client, world):
    users, _ = world

    response = client.post(f"{BASE}/reports/{uuid.uuid4()}/resolve", json={"status": "resolved"}, headers=_mod(users))

    assert response.status_code == 404
    assert response.get_json() == {"msg": "Reporte no encontrado"}


# --- Auditoría -------------------------------------------------------------


def test_the_audit_log_never_stores_secrets_or_credentials(client, app, world):
    users, place_id = world
    client.patch(f"{BASE}/{place_id}", json={"name": "Otro nombre"}, headers=_mod(users))
    client.patch(f"{BASE}/{place_id}/status", json={"is_active": False}, headers=_mod(users))

    with app.app_context():
        dump = db.session.execute(text("SELECT string_agg(changes::text, ' ') FROM admin_audit_log")).scalar()

    for secret in ("password", "token", "Bearer", "secret", "@example.com"):
        assert secret.lower() not in dump.lower()


def test_audit_entries_survive_the_moderator_deleting_the_account(client, app, world):
    users, place_id = world
    client.patch(f"{BASE}/{place_id}", json={"name": "Otro nombre"}, headers=_mod(users))

    with app.app_context():
        db.session.execute(text("DELETE FROM users WHERE id = :u"), {"u": users["mod"][1]})
        db.session.commit()

    assert len(_audit(app)) == 1
    assert _audit(app)[0][3] is None
