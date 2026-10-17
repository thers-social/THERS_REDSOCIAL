# Avisos de Places (ADR-040 fase 12): cada acción de reservas, cotizaciones, planes, reclamos y
# reseñas avisa a la otra parte con un aviso SIN texto libre, único por destinatario, tipo, objeto
# y estado, que no se crea con un bloqueo de por medio ni a quien hizo la acción.

import io
from datetime import datetime, timedelta, timezone

import pytest
from PIL import Image
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.domain.notifications import place_events
from app.extensions import db
from tests.places.helpers import auth, insert_place, make_users
from tests.test_reports import _register_and_login

NOTE = "NOTA-PRIVADA-DEL-CLIENTE"


def _slot(days=2):
    base = datetime.now(timezone.utc) + timedelta(days=days)
    return base.replace(hour=19, minute=0, second=0, microsecond=0).isoformat()


def _avisos(app, user_id, type_=None):
    with app.app_context():
        sql = (
            "SELECT type, actor_id, place_id, object_id, detail FROM notifications "
            "WHERE recipient_id = :u AND type LIKE 'place\\_%' "
        )
        params = {"u": user_id}
        if type_:
            sql += "AND type = :t "
            params["t"] = type_
        return db.session.execute(text(sql + "ORDER BY created_at"), params).mappings().all()


def _png():
    buffer = io.BytesIO()
    Image.new("RGB", (40, 30), (200, 30, 30)).save(buffer, format="PNG")
    return buffer.getvalue()


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
    ana = users["ana"][0]
    assert client.put(
        f"/api/places/{place_id}/manage/reservations/settings",
        json={"enabled": True, "capacity": 6, "max_party_size": 4}, headers=auth(ana),
    ).status_code == 200
    return users, place_id


def _book(client, token, place_id, **extra):
    body = {"starts_at": _slot(), "party_size": 2, "note": NOTE, **extra}
    return client.post(f"/api/places/{place_id}/reservations", json=body, headers=auth(token))


# --- Reservas -----------------------------------------------------------------------------


def test_a_new_reservation_notifies_every_manager_but_not_the_requester(app, client, world):
    users, place_id = world
    with app.app_context():
        db.session.execute(
            text("INSERT INTO place_managers (place_id, user_id) VALUES (:p, :u)"),
            {"p": place_id, "u": users["mod"][1]},
        )
        db.session.commit()
    reservation = _book(client, users["beto"][0], place_id).get_json()["reservation"]

    for manager in ("ana", "mod"):
        rows = _avisos(app, users[manager][1], place_events.RESERVATION_NEW)
        assert len(rows) == 1, manager
        assert str(rows[0]["object_id"]) == reservation["id"] and str(rows[0]["place_id"]) == place_id
        assert str(rows[0]["actor_id"]) == users["beto"][1]
    assert _avisos(app, users["beto"][1]) == []


def test_confirm_and_decline_notify_the_requester_once(app, client, world):
    users, place_id = world
    ana = users["ana"][0]
    first = _book(client, users["beto"][0], place_id, starts_at=_slot(2)).get_json()["reservation"]
    second = _book(client, users["beto"][0], place_id, starts_at=_slot(3)).get_json()["reservation"]
    base = f"/api/places/{place_id}/manage/reservations"
    assert client.post(f"{base}/{first['id']}/confirm", json={}, headers=auth(ana)).status_code == 200
    assert client.post(f"{base}/{second['id']}/decline", json={}, headers=auth(ana)).status_code == 200
    # Repetir la acción ya resuelta falla y no vuelve a avisar.
    assert client.post(f"{base}/{first['id']}/confirm", json={}, headers=auth(ana)).status_code == 409

    rows = _avisos(app, users["beto"][1], place_events.RESERVATION_DECIDED)
    assert sorted(row["detail"] for row in rows) == ["confirmed", "declined"]
    assert {str(row["object_id"]) for row in rows} == {first["id"], second["id"]}


def test_cancelling_notifies_the_managers(app, client, world):
    users, place_id = world
    reservation = _book(client, users["beto"][0], place_id).get_json()["reservation"]
    assert client.delete(f"/api/reservations/{reservation['id']}", headers=auth(users["beto"][0])).status_code == 200
    rows = _avisos(app, users["ana"][1], place_events.RESERVATION_CANCELLED)
    assert len(rows) == 1 and str(rows[0]["object_id"]) == reservation["id"]


# --- Cotizaciones ------------------------------------------------------------------------


def test_quotes_notify_the_managers_and_then_the_requester(app, client, world):
    users, place_id = world
    ana, beto = users["ana"][0], users["beto"][0]
    item = client.post(
        f"/api/places/{place_id}/manage/quote-items",
        json={"name": "Menú", "unit": "person", "unit_price_cents": 1250}, headers=auth(ana),
    ).get_json()["item"]
    quote = client.post(
        f"/api/places/{place_id}/quotes",
        json={"lines": [{"item_id": item["id"], "quantity": 3}], "note": NOTE}, headers=auth(beto),
    ).get_json()["quote"]
    assert len(_avisos(app, users["ana"][1], place_events.QUOTE_NEW)) == 1

    assert client.post(
        f"/api/places/{place_id}/manage/quotes/{quote['id']}/decision",
        json={"decision": "accepted"}, headers=auth(ana),
    ).status_code == 200
    rows = _avisos(app, users["beto"][1], place_events.QUOTE_DECIDED)
    assert len(rows) == 1 and rows[0]["detail"] == "accepted" and str(rows[0]["object_id"]) == quote["id"]


# --- Planes ------------------------------------------------------------------------------


def test_plan_invitations_notify_the_invitees_once(app, client):
    people = {name: _register_and_login(client, name) for name in ("ana", "beto", "carla")}
    for other in ("beto", "carla"):
        client.post(f"/api/users/{people[other][1]}/follow", headers=auth(people["ana"][0]))
        client.post(f"/api/users/{people['ana'][1]}/follow", headers=auth(people[other][0]))
    with app.app_context():
        place_id = insert_place("Café Aurora")
    plan = client.post(
        f"/api/places/{place_id}/plans",
        json={"title": "Café", "starts_at": (datetime.now(timezone.utc) + timedelta(days=3)).isoformat(),
              "user_ids": [people["beto"][1]]},
        headers=auth(people["ana"][0]),
    ).get_json()["plan"]
    client.post(f"/api/plans/{plan['id']}/invites",
                json={"user_ids": [people["beto"][1], people["carla"][1]]}, headers=auth(people["ana"][0]))

    assert len(_avisos(app, people["beto"][1], place_events.PLAN_INVITE)) == 1  # sin duplicado
    assert len(_avisos(app, people["carla"][1], place_events.PLAN_INVITE)) == 1
    assert _avisos(app, people["ana"][1]) == []


# --- Reclamos y reseñas -------------------------------------------------------------------


def _claim(client, token, place_id):
    return client.post(
        f"/api/places/{place_id}/claims",
        data={"business_name": "Café S.A.", "message": "Soy la dueña", "document": (io.BytesIO(_png()), "d.png")},
        headers=auth(token), content_type="multipart/form-data",
    ).get_json()["claim"]


def test_a_decided_claim_notifies_without_naming_the_moderator(app, client):
    users = make_users(app, client, with_moderator=True)
    with app.app_context():
        place_id = insert_place("Café Aurora")
    mine = _claim(client, users["ana"][0], place_id)
    other = _claim(client, users["beto"][0], place_id)
    assert client.post(
        f"/api/moderation/place-claims/{mine['id']}/approve", json={"note": "ok"}, headers=auth(users["mod"][0])
    ).status_code == 200

    ana_rows = _avisos(app, users["ana"][1], place_events.CLAIM_DECIDED)
    beto_rows = _avisos(app, users["beto"][1], place_events.CLAIM_DECIDED)
    assert [(r["detail"], r["actor_id"]) for r in ana_rows] == [("approved", None)]
    # Quien quedó rechazado por la aprobación también se entera, también sin actor.
    assert [(r["detail"], r["actor_id"], str(r["object_id"])) for r in beto_rows] == [("rejected", None, other["id"])]

    listed = client.get("/api/notifications", headers=auth(users["ana"][0])).get_json()["notifications"]
    assert listed[0]["actor"] is None and listed[0]["place"] == {"id": place_id, "name": "Café Aurora"}
    assert users["mod"][1] not in str(listed)


def test_a_reply_notifies_the_reviewer_once_even_if_edited(app, client, world):
    users, place_id = world
    client.put(f"/api/places/{place_id}/review", json={"rating": 5, "body": "Rico"}, headers=auth(users["beto"][0]))
    review_id = client.get(f"/api/places/{place_id}/reviews", headers=auth(users["ana"][0])).get_json()["reviews"][0]["id"]
    url = f"/api/places/{place_id}/reviews/{review_id}/reply"
    client.put(url, json={"body": "Gracias"}, headers=auth(users["ana"][0]))
    client.put(url, json={"body": "Gracias de nuevo"}, headers=auth(users["ana"][0]))
    rows = _avisos(app, users["beto"][1], place_events.REVIEW_REPLY)
    assert len(rows) == 1 and str(rows[0]["object_id"]) == review_id


def test_replying_to_your_own_review_does_not_notify_you(app, client, world):
    users, place_id = world
    ana = users["ana"][0]
    client.put(f"/api/places/{place_id}/review", json={"rating": 5, "body": "Mío"}, headers=auth(ana))
    review_id = client.get(f"/api/places/{place_id}/reviews", headers=auth(ana)).get_json()["reviews"][0]["id"]
    client.put(f"/api/places/{place_id}/reviews/{review_id}/reply", json={"body": "ok"}, headers=auth(ana))
    assert _avisos(app, users["ana"][1]) == []


# --- Reglas transversales ------------------------------------------------------------------


@pytest.mark.parametrize("direction", ["manager_blocks", "requester_blocks"])
def test_a_block_between_the_parties_creates_no_notice(app, client, world, direction):
    users, place_id = world
    owner, target = ("ana", "beto") if direction == "manager_blocks" else ("beto", "ana")
    assert client.post("/api/users/me/blocks", json={"user_id": users[target][1]},
                       headers=auth(users[owner][0])).status_code in (200, 201)
    assert _book(client, users["beto"][0], place_id).status_code == 201
    assert _avisos(app, users["ana"][1]) == []


def test_the_notice_carries_no_free_text(app, client, world):
    users, place_id = world
    _book(client, users["beto"][0], place_id)
    body = client.get("/api/notifications", headers=auth(users["ana"][0])).get_json()
    assert NOTE not in str(body)
    notice = body["notifications"][0]
    assert notice["type"] == place_events.RESERVATION_NEW
    assert set(notice["place"]) == {"id", "name"} and notice["detail"] is None


def test_only_the_recipient_can_mark_it_as_read(app, client, world):
    users, place_id = world
    _book(client, users["beto"][0], place_id)
    notice_id = client.get("/api/notifications", headers=auth(users["ana"][0])).get_json()["notifications"][0]["id"]
    assert client.patch(f"/api/notifications/{notice_id}/read", headers=auth(users["beto"][0])).status_code == 404
    assert client.patch(f"/api/notifications/{notice_id}/read", headers=auth(users["ana"][0])).status_code == 200


def test_a_blocked_listing_still_shows_actorless_notices(app, client):
    users = make_users(app, client, with_moderator=True)
    with app.app_context():
        place_id = insert_place("Café Aurora")
    client.post("/api/users/me/blocks", json={"user_id": users["beto"][1]}, headers=auth(users["ana"][0]))
    claim = _claim(client, users["ana"][0], place_id)
    client.post(f"/api/moderation/place-claims/{claim['id']}/reject", json={"note": "Falta el documento"},
                headers=auth(users["mod"][0]))
    listed = client.get("/api/notifications", headers=auth(users["ana"][0])).get_json()["notifications"]
    assert [n["type"] for n in listed] == [place_events.CLAIM_DECIDED]  # el NOT IN no lo oculta


def test_a_failing_notice_never_breaks_the_action(app, client, world, monkeypatch):
    users, place_id = world

    def boom(*args, **kwargs):
        raise RuntimeError("fallo simulado")

    monkeypatch.setattr("app.infrastructure.persistence.repositories.place_notifications.text", boom)
    assert _book(client, users["beto"][0], place_id).status_code == 201
    assert _avisos(app, users["ana"][1]) == []
    monkeypatch.undo()
    assert _book(client, users["beto"][0], place_id, starts_at=_slot(3)).status_code == 201
    assert len(_avisos(app, users["ana"][1])) == 1  # la sesión quedó sana


def test_deleting_the_place_or_the_person_removes_the_notices(app, client, world):
    users, place_id = world
    _book(client, users["beto"][0], place_id)
    assert len(_avisos(app, users["ana"][1])) == 1
    with app.app_context():
        db.session.execute(text("DELETE FROM places WHERE id = :p"), {"p": place_id})
        db.session.commit()
    assert _avisos(app, users["ana"][1]) == []


def test_the_database_rejects_inconsistent_rows(app, client, world):
    users, place_id = world
    with app.app_context():
        for sql, params in (
            # Un evento de Places sin lugar.
            ("INSERT INTO notifications (recipient_id, actor_id, type) VALUES (:r, :a, 'place_quote_new')",
             {"r": users["ana"][1], "a": users["beto"][1]}),
            # Sin actor en un tipo que no es «reclamo decidido».
            ("INSERT INTO notifications (recipient_id, type, place_id) VALUES (:r, 'place_quote_new', :p)",
             {"r": users["ana"][1], "p": place_id}),
        ):
            with pytest.raises(IntegrityError):
                db.session.execute(text(sql), params)
            db.session.rollback()


def test_the_export_includes_actorless_notices(app, client):
    from app.infrastructure.persistence.repositories.data_export_repository import SQLAlchemyDataExportRepository

    users = make_users(app, client, with_moderator=True)
    with app.app_context():
        place_id = insert_place("Café Aurora")
    claim = _claim(client, users["ana"][0], place_id)
    client.post(f"/api/moderation/place-claims/{claim['id']}/approve", json={"note": "ok"}, headers=auth(users["mod"][0]))
    with app.app_context():
        data = SQLAlchemyDataExportRepository().collect_user_data(users["ana"][1])
    mine = [n for n in data["notifications"] if n["type"] == place_events.CLAIM_DECIDED]
    assert len(mine) == 1 and mine[0]["from_username"] is None and mine[0]["detail"] == "approved"
