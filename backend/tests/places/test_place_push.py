# Push de los avisos de THERS Places (ADR-053 + ADR-040 fase 12): todo aviso que aparece en la lista de
# notificaciones también llega al teléfono. Firebase es un cliente falso: nada sale a la red.

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from app.domain.push import payloads
from app.extensions import db
from tests.places.helpers import auth, insert_place, make_users
from tests.test_push import TOKEN_A, TOKEN_B, FakeFcm, _register, fcm  # noqa: F401 (fixture)


def _slot(days=2):
    base = datetime.now(timezone.utc) + timedelta(days=days)
    return base.replace(hour=19, minute=0, second=0, microsecond=0).isoformat()


@pytest.fixture()
def world(app, client):
    users = make_users(app, client, with_moderator=False)  # ana gestiona; beto reserva
    with app.app_context():
        place_id = insert_place("Café Aurora")
        db.session.execute(
            text("INSERT INTO place_managers (place_id, user_id) VALUES (:p, :u)"),
            {"p": place_id, "u": users["ana"][1]},
        )
        db.session.commit()
    assert client.put(
        f"/api/places/{place_id}/manage/reservations/settings",
        json={"enabled": True, "capacity": 6, "max_party_size": 4},
        headers=auth(users["ana"][0]),
    ).status_code == 200
    assert _register(client, users["ana"][0], TOKEN_A).status_code == 200
    assert _register(client, users["beto"][0], TOKEN_B).status_code == 200
    return users, place_id


def _book(client, token, place_id, days=2):
    return client.post(
        f"/api/places/{place_id}/reservations",
        json={"starts_at": _slot(days), "party_size": 2},
        headers=auth(token),
    )


def test_a_new_reservation_pushes_to_the_manager_only(client, fcm, world):
    users, place_id = world

    reservation = _book(client, users["beto"][0], place_id).get_json()["reservation"]

    assert [sent["token"] for sent in fcm.sent] == [TOKEN_A]
    sent = fcm.sent[0]
    assert sent["title"] == "Café Aurora" and sent["body"] == "Nueva solicitud de reserva"
    assert sent["data"] == {
        "type": "place_reservation_new", "place_id": place_id, "object_id": reservation["id"],
    }


def test_confirming_and_declining_push_to_the_requester_once(client, fcm, world):
    users, place_id = world
    first = _book(client, users["beto"][0], place_id, 2).get_json()["reservation"]
    second = _book(client, users["beto"][0], place_id, 3).get_json()["reservation"]
    fcm.sent.clear()
    base = f"/api/places/{place_id}/manage/reservations"
    ana = auth(users["ana"][0])

    assert client.post(f"{base}/{first['id']}/confirm", json={}, headers=ana).status_code == 200
    assert client.post(f"{base}/{second['id']}/decline", json={}, headers=ana).status_code == 200
    # Repetir una acción ya resuelta falla y no vuelve a enviar nada.
    assert client.post(f"{base}/{first['id']}/confirm", json={}, headers=ana).status_code == 409

    assert [sent["token"] for sent in fcm.sent] == [TOKEN_B, TOKEN_B]
    assert [sent["body"] for sent in fcm.sent] == ["Confirmó tu reserva", "Rechazó tu reserva"]


def test_no_push_without_a_registered_device(client, fcm, world):
    users, place_id = world
    client.delete("/api/push/devices", json={"token": TOKEN_A}, headers=auth(users["ana"][0]))

    _book(client, users["beto"][0], place_id)

    assert fcm.sent == []


class TestPayloads:
    def test_every_place_event_has_a_text(self):
        from app.domain.notifications.place_events import PLACE_EVENT_TYPES

        for event in PLACE_EVENT_TYPES:
            payload = payloads.place_notice_payload(event, None, "Café Aurora", "p-1", "o-1")
            assert payload is not None, event
            title, body, data = payload
            assert title == "Café Aurora" and body and data["type"] == event
            assert data["place_id"] == "p-1" and data["object_id"] == "o-1"

    def test_the_state_changes_the_text_and_an_unknown_state_has_a_fallback(self):
        text_of = lambda event, detail: payloads.place_notice_payload(event, detail, "X", "p")[1]  # noqa: E731
        assert text_of("place_quote_decided", "accepted") == "Aceptó tu cotización"
        assert text_of("place_claim_decided", "approved").startswith("Aprobó tu reclamo")
        assert text_of("place_reservation_decided", "algo") == "Actualizó tu reserva"

    def test_a_non_place_type_is_not_a_place_notice(self):
        assert payloads.place_notice_payload("like", None, "X", "p") is None

    def test_a_long_place_name_is_cut(self):
        title = payloads.place_notice_payload("place_plan_invite", None, "N" * 200, "p")[0]
        assert len(title) <= 60 and title.endswith("…")
