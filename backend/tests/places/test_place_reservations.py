# Reservas (ADR-040 fase 8): solo en lugares públicos que las activaron quien los gestiona;
# cupo por horario garantizado bajo bloqueo; confirmar/rechazar solo por quien gestiona;
# cancelar solo la propia; 404 a quien no es parte; exportación y borrado de cuenta.

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from app.extensions import db
from tests.places.helpers import auth, insert_place, make_users

MISSING = "00000000-0000-4000-8000-000000000000"


def _slot(days=2, hour=19, minute=0):
    base = datetime.now(timezone.utc) + timedelta(days=days)
    return base.replace(hour=hour, minute=minute, second=0, microsecond=0).isoformat()


def _scalar(app, sql, **params):
    with app.app_context():
        return db.session.execute(text(sql), params).scalar()


def _book(client, token, place_id, **overrides):
    body = {"starts_at": _slot(), "party_size": 2, **overrides}
    return client.post(f"/api/places/{place_id}/reservations", json=body, headers=auth(token))


def _settings(client, token, place_id, **body):
    return client.put(
        f"/api/places/{place_id}/manage/reservations/settings", json=body, headers=auth(token)
    )


@pytest.fixture()
def world(app, client):
    users = make_users(app, client, with_moderator=True)  # ana gestiona; beto y mod no
    with app.app_context():
        place_id = insert_place("Café Aurora")
        db.session.execute(
            text("INSERT INTO place_managers (place_id, user_id) VALUES (:p, :u)"),
            {"p": place_id, "u": users["ana"][1]},
        )
        db.session.commit()
    return users, place_id


@pytest.fixture()
def open_world(client, world):
    users, place_id = world
    assert _settings(client, users["ana"][0], place_id, enabled=True, capacity=6, max_party_size=4).status_code == 200
    return users, place_id


# --- Configuración ---------------------------------------------------------------


def test_only_the_manager_configures_reservations(client, world):
    users, place_id = world
    base = f"/api/places/{place_id}/manage/reservations"
    for token in (users["beto"][0], users["mod"][0]):
        assert client.get(f"{base}/settings", headers=auth(token)).status_code == 404
        assert _settings(client, token, place_id, enabled=True).status_code == 404
        assert client.get(base, headers=auth(token)).status_code == 404
    assert client.get(f"{base}/settings").status_code == 401


def test_settings_defaults_and_validation(client, world):
    users, place_id = world
    got = client.get(f"/api/places/{place_id}/manage/reservations/settings", headers=auth(users["ana"][0]))
    assert got.get_json()["settings"] == {"enabled": False, "capacity": 10, "max_party_size": 8}
    for bad in (
        {"enabled": "yes"}, {"capacity": 0}, {"capacity": 501}, {"capacity": True},
        {"max_party_size": 51}, {"capacity": 4, "max_party_size": 5}, {"capacity": "10"},
    ):
        assert _settings(client, users["ana"][0], place_id, **bad).status_code == 400
    ok = _settings(client, users["ana"][0], place_id, enabled=True, capacity=20, max_party_size=6)
    assert ok.get_json()["settings"] == {"enabled": True, "capacity": 20, "max_party_size": 6}


def test_place_detail_says_whether_it_accepts_reservations(client, world):
    users, place_id = world
    url = f"/api/places/{place_id}"
    assert client.get(url, headers=auth(users["beto"][0])).get_json()["place"]["accepts_reservations"] is False
    _settings(client, users["ana"][0], place_id, enabled=True)
    assert client.get(url, headers=auth(users["beto"][0])).get_json()["place"]["accepts_reservations"] is True


# --- Solicitar ---------------------------------------------------------------------


def test_book_a_table(client, open_world):
    users, place_id = open_world
    response = _book(client, users["beto"][0], place_id, note="  Ventana, por favor  ")

    assert response.status_code == 201
    reservation = response.get_json()["reservation"]
    assert reservation["status"] == "pending"
    assert reservation["party_size"] == 2 and reservation["note"] == "Ventana, por favor"
    assert reservation["place"]["name"] == "Café Aurora"
    mine = client.get("/api/reservations", headers=auth(users["beto"][0])).get_json()["reservations"]
    assert [r["id"] for r in mine] == [reservation["id"]]
    assert client.get("/api/reservations", headers=auth(users["ana"][0])).get_json() == {"reservations": []}


def test_requires_a_session(client, open_world):
    _, place_id = open_world
    assert client.post(f"/api/places/{place_id}/reservations", json={}).status_code == 401
    assert client.get("/api/reservations").status_code == 401


def test_closed_or_unconfigured_places_do_not_take_reservations(client, world):
    users, place_id = world
    assert _book(client, users["beto"][0], place_id).status_code == 409  # sin configurar
    _settings(client, users["ana"][0], place_id, enabled=True)
    _settings(client, users["ana"][0], place_id, enabled=False)
    assert _book(client, users["beto"][0], place_id).status_code == 409


def test_only_public_places(client, app, open_world):
    users, _ = open_world
    with app.app_context():
        hidden = insert_place("Oculto", active=False)
    for place_id in (hidden, MISSING):
        assert _book(client, users["beto"][0], place_id).status_code == 404


@pytest.mark.parametrize(
    "overrides",
    [
        {"starts_at": None}, {"starts_at": "mañana"}, {"starts_at": "2030-01-01T19:00:00"},
        {"starts_at": _slot(days=-1)}, {"starts_at": _slot(days=120)},
        {"starts_at": _slot(minute=10)}, {"party_size": 0}, {"party_size": 5},  # max 4
        {"party_size": "2"}, {"party_size": True}, {"party_size": 2.5}, {"note": "x" * 301},
        {"note": "a\x00b"}, {"note": 5},
    ],
)
def test_invalid_requests_are_rejected_and_nothing_is_saved(client, app, open_world, overrides):
    users, place_id = open_world
    assert _book(client, users["beto"][0], place_id, **overrides).status_code == 400
    assert _scalar(app, "SELECT count(*) FROM place_reservations") == 0


def test_too_soon_is_rejected(client, open_world):
    users, place_id = open_world
    soon = (datetime.now(timezone.utc) + timedelta(minutes=10)).replace(second=0, microsecond=0)
    soon = soon.replace(minute=soon.minute - soon.minute % 15)
    assert _book(client, users["beto"][0], place_id, starts_at=soon.isoformat()).status_code == 400


def test_capacity_per_slot_is_enforced(client, app, open_world):
    users, place_id = open_world  # capacidad 6
    assert _book(client, users["beto"][0], place_id, party_size=4).status_code == 201
    assert _book(client, users["mod"][0], place_id, party_size=3).status_code == 409  # 4+3 > 6
    assert _book(client, users["mod"][0], place_id, party_size=2).status_code == 201  # 4+2 = 6
    assert _book(client, users["ana"][0], place_id, party_size=1).status_code == 409
    # Otro horario tiene su propio cupo.
    assert _book(client, users["ana"][0], place_id, party_size=1, starts_at=_slot(hour=20)).status_code == 201
    assert _scalar(app, "SELECT sum(party_size) FROM place_reservations WHERE status = 'pending' "
                        "AND starts_at = (SELECT min(starts_at) FROM place_reservations)") == 6


def test_declined_and_cancelled_reservations_free_the_seats(client, open_world):
    users, place_id = open_world
    first = _book(client, users["beto"][0], place_id, party_size=4).get_json()["reservation"]
    assert _book(client, users["mod"][0], place_id, party_size=4).status_code == 409
    client.delete(f"/api/reservations/{first['id']}", headers=auth(users["beto"][0]))
    assert _book(client, users["mod"][0], place_id, party_size=4).status_code == 201


def test_no_duplicates_and_a_limit_of_active_reservations(client, open_world):
    users, place_id = open_world
    assert _book(client, users["beto"][0], place_id).status_code == 201
    assert _book(client, users["beto"][0], place_id).status_code == 409  # mismo horario
    for hour in (10, 11, 12, 13):
        assert _book(client, users["beto"][0], place_id, party_size=1, starts_at=_slot(hour=hour)).status_code == 201
    assert _book(client, users["beto"][0], place_id, party_size=1, starts_at=_slot(hour=14)).status_code == 409


def test_concurrent_requests_never_oversell(app, open_world):
    """Dos peticiones simultáneas por los últimos asientos: solo una entra."""
    from concurrent.futures import ThreadPoolExecutor

    from app.infrastructure.persistence.repositories.reservation_repository import (
        SQLAlchemyReservationRepository,
    )

    users, place_id = open_world
    starts = datetime.fromisoformat(_slot())

    def attempt(user_id):
        with app.app_context():
            try:
                SQLAlchemyReservationRepository().create(user_id, place_id, starts, 4, None)
                return True
            except Exception:  # noqa: BLE001
                return False

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(attempt, [users["beto"][1], users["mod"][1]]))
    assert sorted(results) == [False, True]
    assert _scalar(app, "SELECT sum(party_size) FROM place_reservations") == 4


def test_rate_limited(client, open_world, monkeypatch):
    from app.domain.rate_limiting import policy
    from app.domain.rate_limiting.policy import RateLimitRule

    monkeypatch.setattr(policy, "RESERVATION_WRITE", RateLimitRule("reservation_write", 1, 3600, clear_on_success=False))
    users, place_id = open_world
    assert _book(client, users["beto"][0], place_id).status_code == 201
    assert _book(client, users["beto"][0], place_id, starts_at=_slot(hour=20)).status_code == 429


def test_identity_comes_from_the_token(client, app, open_world):
    users, place_id = open_world
    _book(client, users["beto"][0], place_id, user_id=users["mod"][1], status="confirmed")
    assert _scalar(app, "SELECT user_id::text || status FROM place_reservations") == users["beto"][1] + "pending"


# --- Cancelar ----------------------------------------------------------------------


def test_cancel_only_my_own_active_reservation(client, open_world):
    users, place_id = open_world
    reservation = _book(client, users["beto"][0], place_id).get_json()["reservation"]
    url = f"/api/reservations/{reservation['id']}"

    assert client.delete(url, headers=auth(users["mod"][0])).status_code == 404
    assert client.delete(f"/api/reservations/{MISSING}", headers=auth(users["beto"][0])).status_code == 404
    done = client.delete(url, headers=auth(users["beto"][0]))
    assert done.status_code == 200 and done.get_json()["reservation"]["status"] == "cancelled"
    assert client.delete(url, headers=auth(users["beto"][0])).status_code == 409


# --- Resolver ----------------------------------------------------------------------


def test_manager_lists_and_confirms(client, open_world):
    users, place_id = open_world
    reservation = _book(client, users["beto"][0], place_id).get_json()["reservation"]
    base = f"/api/places/{place_id}/manage/reservations"

    listing = client.get(f"{base}?status=pending", headers=auth(users["ana"][0])).get_json()
    assert [r["id"] for r in listing["reservations"]] == [reservation["id"]]
    person = listing["reservations"][0]["user"]
    assert set(person) == {"id", "username", "name", "avatar_url"} and person["id"] == users["beto"][1]
    assert client.get(f"{base}?status=raro", headers=auth(users["ana"][0])).status_code == 400

    done = client.post(f"{base}/{reservation['id']}/confirm", json={"note": "¡Los esperamos!"}, headers=auth(users["ana"][0]))
    assert done.status_code == 200 and done.get_json()["reservation"]["status"] == "confirmed"
    mine = client.get("/api/reservations", headers=auth(users["beto"][0])).get_json()["reservations"]
    assert mine[0]["status"] == "confirmed" and mine[0]["decision_note"] == "¡Los esperamos!"
    # Ya resuelta: no se vuelve a resolver, pero la persona aún puede cancelarla.
    assert client.post(f"{base}/{reservation['id']}/decline", headers=auth(users["ana"][0])).status_code == 409
    assert client.delete(f"/api/reservations/{reservation['id']}", headers=auth(users["beto"][0])).status_code == 200


def test_decline_frees_the_seats(client, open_world):
    users, place_id = open_world
    reservation = _book(client, users["beto"][0], place_id, party_size=4).get_json()["reservation"]
    client.post(
        f"/api/places/{place_id}/manage/reservations/{reservation['id']}/decline", headers=auth(users["ana"][0])
    )
    assert _book(client, users["mod"][0], place_id, party_size=4).status_code == 201


def test_only_the_manager_of_that_place_resolves(client, app, open_world):
    users, place_id = open_world
    reservation = _book(client, users["beto"][0], place_id).get_json()["reservation"]
    for token in (users["beto"][0], users["mod"][0]):
        url = f"/api/places/{place_id}/manage/reservations/{reservation['id']}/confirm"
        assert client.post(url, headers=auth(token)).status_code == 404
    # Un gestor de OTRO lugar no resuelve reservas de este.
    with app.app_context():
        other = insert_place("Otro")
        db.session.execute(
            text("INSERT INTO place_managers (place_id, user_id) VALUES (:p, :u)"), {"p": other, "u": users["mod"][1]}
        )
        db.session.commit()
    url = f"/api/places/{other}/manage/reservations/{reservation['id']}/confirm"
    assert client.post(url, headers=auth(users["mod"][0])).status_code == 404
    assert _scalar(app, "SELECT status FROM place_reservations") == "pending"


# --- Exportación y eliminación de cuenta ----------------------------------------------


def test_data_export_includes_my_reservations(client, app, open_world):
    users, place_id = open_world
    _book(client, users["beto"][0], place_id, note="Ventana")
    from app.infrastructure.persistence.repositories.data_export_repository import (
        SQLAlchemyDataExportRepository,
    )

    with app.app_context():
        data = SQLAlchemyDataExportRepository().collect_user_data(users["beto"][1])
    assert [(r["place"], r["party_size"], r["note"], r["status"]) for r in data["place_reservations"]] == [
        ("Café Aurora", 2, "Ventana", "pending")
    ]


def test_deleting_the_person_removes_their_reservations(client, app, open_world):
    users, place_id = open_world
    _book(client, users["beto"][0], place_id)
    with app.app_context():
        db.session.execute(text("DELETE FROM users WHERE id = :i"), {"i": users["beto"][1]})
        db.session.commit()
    assert _scalar(app, "SELECT count(*) FROM place_reservations") == 0
