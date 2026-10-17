# Compartir un lugar por chat (ADR-040 fase 4c): `place_id` en el envío de un mensaje directo.
# Cubre la tarjeta en el hilo, que solo se comparten lugares públicos, bloqueos y permisos
# (no se saltan), idempotencia, el lugar que deja de ser público y la lista de conversaciones.

import pytest
from sqlalchemy import text

from app.extensions import db
from tests.places.helpers import auth, insert_place, make_users

MISSING = "00000000-0000-4000-8000-000000000000"


def _send(client, token, to_id, **body):
    return client.post(f"/api/users/{to_id}/messages", json=body, headers=auth(token))


def _thread(client, token, other_id):
    return client.get(f"/api/users/{other_id}/messages", headers=auth(token)).get_json()["messages"]


@pytest.fixture()
def world(app, client):
    users = make_users(app, client)
    with app.app_context():
        place_id = insert_place(
            "Café Aurora", municipality="San Salvador", department="San Salvador"
        )
    return users, place_id


def test_share_a_place_with_a_comment(client, world):
    users, place_id = world

    response = _send(client, users["ana"][0], users["beto"][1], place_id=place_id, content="Vamos?")

    assert response.status_code == 201
    message = response.get_json()["message"]
    assert message["content"] == "Vamos?"
    assert message["place"] == {
        "id": place_id,
        "available": True,
        "name": "Café Aurora",
        "category": {"slug": "cafes", "name": message["place"]["category"]["name"]},
        "municipality": "San Salvador",
        "department": "San Salvador",
    }


def test_the_text_is_optional_when_sharing_a_place(client, world):
    users, place_id = world
    response = _send(client, users["ana"][0], users["beto"][1], place_id=place_id)
    assert response.status_code == 201
    assert response.get_json()["message"]["content"] == ""


def test_a_plain_message_still_needs_text_and_has_no_place(client, world):
    users, _ = world
    assert _send(client, users["ana"][0], users["beto"][1], content="  ").status_code == 400
    plain = _send(client, users["ana"][0], users["beto"][1], content="hola")
    assert plain.get_json()["message"]["place"] is None


def test_the_card_shows_up_in_the_thread_for_both_people(client, world):
    users, place_id = world
    _send(client, users["ana"][0], users["beto"][1], place_id=place_id, content="mira")

    for token, other in ((users["ana"][0], users["beto"][1]), (users["beto"][0], users["ana"][1])):
        messages = _thread(client, token, other)
        assert messages[0]["place"]["name"] == "Café Aurora"


def test_the_card_never_carries_coordinates_or_internal_fields(client, world):
    users, place_id = world
    card = _send(client, users["ana"][0], users["beto"][1], place_id=place_id).get_json()["message"]["place"]
    assert set(card) == {"id", "available", "name", "category", "municipality", "department"}


def test_unknown_or_non_public_places_cannot_be_shared(client, app, world):
    users, _ = world
    with app.app_context():
        pending = insert_place("Pendiente", status="pending")
        inactive = insert_place("Inactivo", active=False)
    for place_id in (MISSING, pending, inactive):
        response = _send(client, users["ana"][0], users["beto"][1], place_id=place_id)
        assert response.status_code == 404
    assert _thread(client, users["ana"][0], users["beto"][1]) == []


@pytest.mark.parametrize("bad", ["no-es-uuid", 123, ["x"], True])
def test_a_malformed_place_id_is_400(client, world, bad):
    users, _ = world
    assert _send(client, users["ana"][0], users["beto"][1], place_id=bad, content="x").status_code == 400


def test_blocks_and_privacy_are_not_bypassed(client, world):
    users, place_id = world
    ana, beto = users["ana"][0], users["beto"][0]
    client.patch("/api/users/me/privacy", json={"who_can_message": "nobody"}, headers=auth(beto))
    assert _send(client, ana, users["beto"][1], place_id=place_id).status_code == 403

    client.patch("/api/users/me/privacy", json={"who_can_message": "everyone"}, headers=auth(beto))
    client.post("/api/users/me/blocks", json={"user_id": users["ana"][1]}, headers=auth(beto))
    assert _send(client, ana, users["beto"][1], place_id=place_id).status_code == 404


def test_you_cannot_share_a_place_with_yourself(client, world):
    users, place_id = world
    assert _send(client, users["ana"][0], users["ana"][1], place_id=place_id).status_code == 400


def test_retrying_with_the_same_client_id_does_not_duplicate(client, world):
    users, place_id = world
    first = _send(client, users["ana"][0], users["beto"][1], place_id=place_id, client_id="abc-1")
    second = _send(client, users["ana"][0], users["beto"][1], place_id=place_id, client_id="abc-1")
    assert (first.status_code, second.status_code) == (201, 200)
    assert second.get_json()["message"]["id"] == first.get_json()["message"]["id"]
    assert len(_thread(client, users["ana"][0], users["beto"][1])) == 1


def test_a_place_that_stops_being_public_shows_as_unavailable(client, app, world):
    users, place_id = world
    _send(client, users["ana"][0], users["beto"][1], place_id=place_id)
    with app.app_context():
        db.session.execute(text("UPDATE places SET verification_status = 'rejected'"))
        db.session.commit()

    card = _thread(client, users["beto"][0], users["ana"][1])[0]["place"]

    assert card == {"id": place_id, "available": False}  # ni nombre ni ubicación


def test_a_deleted_place_keeps_the_message(client, app, world):
    users, place_id = world
    _send(client, users["ana"][0], users["beto"][1], place_id=place_id, content="mira")
    with app.app_context():
        db.session.execute(text("DELETE FROM places WHERE id = :p"), {"p": place_id})
        db.session.commit()

    message = _thread(client, users["beto"][0], users["ana"][1])[0]

    assert message["content"] == "mira" and message["place"] is None


def test_conversations_flag_a_place_message(client, world):
    users, place_id = world
    _send(client, users["ana"][0], users["beto"][1], place_id=place_id)

    conversations = client.get("/api/conversations", headers=auth(users["beto"][0])).get_json()["conversations"]

    assert conversations[0]["last_message"]["has_place"] is True
    assert conversations[0]["last_message"]["content"] == ""


def test_editing_keeps_the_card(client, world):
    users, place_id = world
    sent = _send(client, users["ana"][0], users["beto"][1], place_id=place_id, content="mira").get_json()["message"]

    edited = client.patch(f"/api/messages/{sent['id']}", json={"content": "mira esto"}, headers=auth(users["ana"][0]))

    assert edited.status_code == 200
    assert edited.get_json()["message"]["place"]["name"] == "Café Aurora"


def test_the_thread_resolves_cards_in_one_query(client, app, world):
    users, _ = world
    with app.app_context():
        ids = [insert_place(f"Lugar {i}") for i in range(5)]
    for place_id in ids:
        _send(client, users["ana"][0], users["beto"][1], place_id=place_id)

    from sqlalchemy import event

    statements = []
    with app.app_context():
        engine = db.engine
        event.listen(engine, "before_cursor_execute", lambda *a: statements.append(a[2]))
    _thread(client, users["beto"][0], users["ana"][1])

    assert sum("FROM places" in s for s in statements) == 1
