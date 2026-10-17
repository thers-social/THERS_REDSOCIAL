# Planes con amistades (ADR-040 fase 5): crear, invitar solo a amistades (seguimiento mutuo
# sin bloqueo), ver solo siendo integrante, responder, editar/cancelar solo quien creó el plan,
# salirse, tope de integrantes, límite de uso, bloqueos, exportación y borrado de cuenta.

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from app.domain.plans import kinds
from app.extensions import db
from tests.places.helpers import auth, insert_place
from tests.test_reports import _register_and_login

MISSING = "00000000-0000-4000-8000-000000000000"


def _when(days=3):
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()


def _befriend(client, a, b):
    """Seguimiento mutuo entre dos cuentas públicas."""
    client.post(f"/api/users/{b[1]}/follow", headers=auth(a[0]))
    client.post(f"/api/users/{a[1]}/follow", headers=auth(b[0]))


def _create(client, token, place_id, **overrides):
    body = {"title": "Café el sábado", "starts_at": _when(), **overrides}
    return client.post(f"/api/places/{place_id}/plans", json=body, headers=auth(token))


def _get(client, token, plan_id):
    return client.get(f"/api/plans/{plan_id}", headers=auth(token))


def _count(app, table="place_plans"):
    with app.app_context():
        return db.session.execute(text(f"SELECT count(*) FROM {table}")).scalar()


@pytest.fixture()
def world(app, client):
    people = {name: _register_and_login(client, name) for name in ("ana", "beto", "carla", "dani")}
    _befriend(client, people["ana"], people["beto"])
    _befriend(client, people["ana"], people["carla"])
    # dani solo sigue a ana: no es amistad.
    client.post(f"/api/users/{people['ana'][1]}/follow", headers=auth(people["dani"][0]))
    with app.app_context():
        place_id = insert_place("Café Aurora", municipality="San Salvador")
    return people, place_id


# --- Crear ------------------------------------------------------------------


def test_create_a_plan_and_invite_friends(client, world):
    people, place_id = world
    response = _create(
        client, people["ana"][0], place_id,
        note="  Llevo juegos  ", user_ids=[people["beto"][1], people["carla"][1]],
    )

    assert response.status_code == 201
    plan = response.get_json()["plan"]
    assert plan["title"] == "Café el sábado"
    assert plan["note"] == "Llevo juegos"
    assert plan["status"] == "active"
    assert plan["my_status"] == "going"
    assert plan["place"]["name"] == "Café Aurora"
    assert plan["creator"]["id"] == people["ana"][1]
    assert plan["counts"] == {"going": 1, "invited": 2, "declined": 0}
    assert {m["id"]: m["status"] for m in plan["members"]} == {
        people["ana"][1]: "going", people["beto"][1]: "invited", people["carla"][1]: "invited",
    }
    assert set(plan["creator"]) == {"id", "username", "name", "avatar_url"}


def test_a_plan_without_invites_is_valid(client, world):
    people, place_id = world
    assert _create(client, people["ana"][0], place_id).status_code == 201


def test_only_friends_can_be_invited(client, app, world):
    people, place_id = world
    # dani solo sigue a ana; ana no sigue a dani. Un id inexistente da el mismo error.
    for ids in ([people["dani"][1]], [MISSING], [people["beto"][1], people["dani"][1]]):
        response = _create(client, people["ana"][0], place_id, user_ids=ids)
        assert response.status_code == 400
        assert response.get_json()["msg"] == "Solo puedes invitar a personas que te siguen y sigues"
    assert _count(app) == 0


def test_you_cannot_invite_yourself_and_a_blocked_friend_is_not_a_friend(client, world):
    people, place_id = world
    assert _create(client, people["ana"][0], place_id, user_ids=[people["ana"][1]]).status_code == 400
    client.post("/api/users/me/blocks", json={"user_id": people["beto"][1]},
                headers=auth(people["ana"][0]))
    assert _create(client, people["ana"][0], place_id, user_ids=[people["beto"][1]]).status_code == 400


@pytest.mark.parametrize(
    "overrides",
    [
        {"title": ""}, {"title": None}, {"title": 5}, {"title": "x" * 81},
        {"title": "con\nsalto"}, {"note": "x" * 501}, {"note": 7},
        {"starts_at": None}, {"starts_at": "mañana"}, {"starts_at": "2030-01-01T10:00:00"},
        {"starts_at": _when(-1)}, {"starts_at": _when(400)}, {"starts_at": 12345},
        {"user_ids": "x"}, {"user_ids": [1]}, {"user_ids": ["no-uuid"]},
        {"user_ids": [MISSING] * 20},
    ],
)
def test_invalid_data_is_rejected_and_nothing_is_saved(client, app, world, overrides):
    people, place_id = world
    response = _create(client, people["ana"][0], place_id, **overrides)
    assert response.status_code == 400
    assert _count(app) == 0


def test_create_needs_a_public_place_and_a_session(client, app, world):
    people, _ = world
    with app.app_context():
        hidden = insert_place("Oculto", status="pending")
        inactive = insert_place("Inactivo", active=False)
    for place in (MISSING, hidden, inactive):
        assert _create(client, people["ana"][0], place).status_code == 404
    assert client.post(f"/api/places/{MISSING}/plans", json={}).status_code == 401
    assert client.get("/api/plans").status_code == 401
    assert client.post("/api/places/not-a-uuid/plans", json={}, headers=auth(people["ana"][0])
                       ).status_code == 404
    assert _count(app) == 0


def test_identity_and_status_cannot_be_forged(client, app, world):
    people, place_id = world
    plan = _create(
        client, people["ana"][0], place_id,
        creator_id=people["beto"][1], status="cancelled", id=MISSING,
    ).get_json()["plan"]
    assert plan["creator"]["id"] == people["ana"][1]
    assert plan["status"] == "active"
    assert plan["id"] != MISSING


def test_body_must_be_a_json_object(client, world):
    people, place_id = world
    response = client.post(f"/api/places/{place_id}/plans", data="x", headers=auth(people["ana"][0]))
    assert response.status_code == 400


# --- Ver ----------------------------------------------------------------------


def test_only_members_can_see_a_plan(client, world):
    people, place_id = world
    plan_id = _create(client, people["ana"][0], place_id,
                      user_ids=[people["beto"][1]]).get_json()["plan"]["id"]

    assert _get(client, people["ana"][0], plan_id).status_code == 200
    assert _get(client, people["beto"][0], plan_id).get_json()["plan"]["my_status"] == "invited"
    # carla es amiga pero no fue invitada; dani no tiene relación.
    for name in ("carla", "dani"):
        assert _get(client, people[name][0], plan_id).status_code == 404
    assert _get(client, people["ana"][0], MISSING).status_code == 404
    assert client.get(f"/api/plans/{plan_id}").status_code == 401


def test_list_my_plans_upcoming_and_past(client, app, world):
    people, place_id = world
    later = _create(client, people["ana"][0], place_id, title="Después",
                    starts_at=_when(10), user_ids=[people["beto"][1]]).get_json()["plan"]
    sooner = _create(client, people["ana"][0], place_id, title="Antes",
                     starts_at=_when(2)).get_json()["plan"]
    old = _create(client, people["ana"][0], place_id, title="Viejo").get_json()["plan"]
    with app.app_context():
        db.session.execute(
            text("UPDATE place_plans SET starts_at = now() - interval '2 days' WHERE id = :i"),
            {"i": old["id"]},
        )
        db.session.commit()

    upcoming = client.get("/api/plans", headers=auth(people["ana"][0])).get_json()["plans"]
    assert [p["id"] for p in upcoming] == [sooner["id"], later["id"]]
    past = client.get("/api/plans?scope=past", headers=auth(people["ana"][0])).get_json()["plans"]
    assert [p["id"] for p in past] == [old["id"]]
    # beto solo ve el plan al que lo invitaron.
    beto = client.get("/api/plans", headers=auth(people["beto"][0])).get_json()["plans"]
    assert [p["id"] for p in beto] == [later["id"]]
    assert client.get("/api/plans?scope=otro", headers=auth(people["ana"][0])).status_code == 400
    assert client.get("/api/plans", headers=auth(people["dani"][0])).get_json() == {"plans": []}


def test_a_place_that_stops_being_public_shows_as_unavailable(client, app, world):
    people, place_id = world
    plan_id = _create(client, people["ana"][0], place_id).get_json()["plan"]["id"]
    with app.app_context():
        db.session.execute(text("UPDATE places SET is_active = false WHERE id = :i"), {"i": place_id})
        db.session.commit()
    place = _get(client, people["ana"][0], plan_id).get_json()["plan"]["place"]
    assert place == {"id": place_id, "available": False}


# --- Responder ----------------------------------------------------------------


def test_respond_going_and_declined(client, world):
    people, place_id = world
    plan_id = _create(client, people["ana"][0], place_id,
                      user_ids=[people["beto"][1]]).get_json()["plan"]["id"]
    url = f"/api/plans/{plan_id}/response"

    going = client.put(url, json={"status": "going"}, headers=auth(people["beto"][0]))
    assert going.status_code == 200
    assert going.get_json()["plan"]["my_status"] == "going"
    assert going.get_json()["plan"]["counts"]["going"] == 2

    declined = client.put(url, json={"status": "declined"}, headers=auth(people["beto"][0]))
    assert declined.get_json()["plan"]["counts"] == {"going": 1, "invited": 0, "declined": 1}


@pytest.mark.parametrize("status", ["invited", "maybe", "", None, 1])
def test_respond_rejects_other_values(client, world, status):
    people, place_id = world
    plan_id = _create(client, people["ana"][0], place_id,
                      user_ids=[people["beto"][1]]).get_json()["plan"]["id"]
    response = client.put(f"/api/plans/{plan_id}/response", json={"status": status},
                          headers=auth(people["beto"][0]))
    assert response.status_code == 400


def test_non_members_cannot_respond_and_the_creator_cannot_decline(client, world):
    people, place_id = world
    plan_id = _create(client, people["ana"][0], place_id).get_json()["plan"]["id"]
    url = f"/api/plans/{plan_id}/response"
    assert client.put(url, json={"status": "going"}, headers=auth(people["carla"][0])).status_code == 404
    assert client.put(url, json={"status": "declined"}, headers=auth(people["ana"][0])).status_code == 403


# --- Editar y cancelar ----------------------------------------------------------


def test_creator_edits_the_plan(client, world):
    people, place_id = world
    plan_id = _create(client, people["ana"][0], place_id).get_json()["plan"]["id"]
    new_time = _when(5)

    response = client.patch(f"/api/plans/{plan_id}",
                            json={"title": "Cena", "note": None, "starts_at": new_time},
                            headers=auth(people["ana"][0]))

    assert response.status_code == 200
    plan = response.get_json()["plan"]
    assert plan["title"] == "Cena"
    assert plan["note"] is None
    assert datetime.fromisoformat(plan["starts_at"]) == datetime.fromisoformat(new_time)


def test_edit_validates_and_ignores_forbidden_fields(client, world):
    people, place_id = world
    plan_id = _create(client, people["ana"][0], place_id).get_json()["plan"]["id"]
    url = f"/api/plans/{plan_id}"
    assert client.patch(url, json={"title": ""}, headers=auth(people["ana"][0])).status_code == 400
    assert client.patch(url, json={"starts_at": _when(-1)}, headers=auth(people["ana"][0])).status_code == 400
    plan = client.patch(url, json={"creator_id": people["beto"][1], "place_id": MISSING},
                        headers=auth(people["ana"][0])).get_json()["plan"]
    assert plan["creator"]["id"] == people["ana"][1]
    assert plan["place"]["id"] == place_id


def test_only_the_creator_edits_cancels_or_invites(client, world):
    people, place_id = world
    plan_id = _create(client, people["ana"][0], place_id,
                      user_ids=[people["beto"][1]]).get_json()["plan"]["id"]
    beto = auth(people["beto"][0])
    assert client.patch(f"/api/plans/{plan_id}", json={"title": "x"}, headers=beto).status_code == 403
    assert client.delete(f"/api/plans/{plan_id}", headers=beto).status_code == 403
    assert client.post(f"/api/plans/{plan_id}/invites", json={"user_ids": [people["carla"][1]]},
                       headers=beto).status_code == 403
    # quien no es integrante ni se entera de que existe.
    carla = auth(people["carla"][0])
    assert client.patch(f"/api/plans/{plan_id}", json={"title": "x"}, headers=carla).status_code == 404
    assert client.delete(f"/api/plans/{plan_id}", headers=carla).status_code == 404


def test_cancelled_plan_stays_visible_and_is_closed(client, world):
    people, place_id = world
    plan_id = _create(client, people["ana"][0], place_id,
                      user_ids=[people["beto"][1]]).get_json()["plan"]["id"]

    cancelled = client.delete(f"/api/plans/{plan_id}", headers=auth(people["ana"][0]))
    assert cancelled.status_code == 200
    assert cancelled.get_json()["plan"]["status"] == "cancelled"
    assert _get(client, people["beto"][0], plan_id).get_json()["plan"]["status"] == "cancelled"

    assert client.delete(f"/api/plans/{plan_id}", headers=auth(people["ana"][0])).status_code == 409
    assert client.patch(f"/api/plans/{plan_id}", json={"title": "x"},
                        headers=auth(people["ana"][0])).status_code == 409
    assert client.put(f"/api/plans/{plan_id}/response", json={"status": "going"},
                      headers=auth(people["beto"][0])).status_code == 409
    assert client.post(f"/api/plans/{plan_id}/invites", json={"user_ids": [people["carla"][1]]},
                       headers=auth(people["ana"][0])).status_code == 409


def test_a_past_plan_is_closed(client, app, world):
    people, place_id = world
    plan_id = _create(client, people["ana"][0], place_id,
                      user_ids=[people["beto"][1]]).get_json()["plan"]["id"]
    with app.app_context():
        db.session.execute(
            text("UPDATE place_plans SET starts_at = now() - interval '1 hour' WHERE id = :i"),
            {"i": plan_id},
        )
        db.session.commit()
    assert client.put(f"/api/plans/{plan_id}/response", json={"status": "going"},
                      headers=auth(people["beto"][0])).status_code == 409
    assert client.patch(f"/api/plans/{plan_id}", json={"title": "x"},
                        headers=auth(people["ana"][0])).status_code == 409


# --- Invitar y salir --------------------------------------------------------------


def test_invite_more_friends_later_without_duplicating(client, world):
    people, place_id = world
    plan_id = _create(client, people["ana"][0], place_id,
                      user_ids=[people["beto"][1]]).get_json()["plan"]["id"]
    # beto rechaza; una nueva invitación NO lo reinvita.
    client.put(f"/api/plans/{plan_id}/response", json={"status": "declined"},
               headers=auth(people["beto"][0]))

    response = client.post(f"/api/plans/{plan_id}/invites",
                           json={"user_ids": [people["beto"][1], people["carla"][1]]},
                           headers=auth(people["ana"][0]))

    assert response.status_code == 200
    plan = response.get_json()["plan"]
    assert plan["counts"] == {"going": 1, "invited": 1, "declined": 1}
    assert len(plan["members"]) == 3


def test_invite_needs_friends_and_at_least_one_id(client, world):
    people, place_id = world
    plan_id = _create(client, people["ana"][0], place_id).get_json()["plan"]["id"]
    ana = auth(people["ana"][0])
    url = f"/api/plans/{plan_id}/invites"
    assert client.post(url, json={"user_ids": [people["dani"][1]]}, headers=ana).status_code == 400
    assert client.post(url, json={"user_ids": []}, headers=ana).status_code == 400
    assert client.post(url, json={}, headers=ana).status_code == 400


def test_plan_has_a_member_limit(client, app, world, monkeypatch):
    people, place_id = world
    monkeypatch.setattr(kinds, "MAX_MEMBERS", 2)
    plan_id = _create(client, people["ana"][0], place_id,
                      user_ids=[people["beto"][1]]).get_json()["plan"]["id"]

    response = client.post(f"/api/plans/{plan_id}/invites", json={"user_ids": [people["carla"][1]]},
                           headers=auth(people["ana"][0]))

    assert response.status_code == 409
    assert _count(app, "place_plan_members") == 2


def test_leave_a_plan_and_creator_removes_someone(client, world):
    people, place_id = world
    plan_id = _create(client, people["ana"][0], place_id,
                      user_ids=[people["beto"][1], people["carla"][1]]).get_json()["plan"]["id"]

    # beto se sale: ya no lo ve.
    left = client.delete(f"/api/plans/{plan_id}/members/{people['beto'][1]}",
                         headers=auth(people["beto"][0]))
    assert left.status_code == 200
    assert _get(client, people["beto"][0], plan_id).status_code == 404

    # carla no puede sacar a nadie; ana sí.
    assert client.delete(f"/api/plans/{plan_id}/members/{people['ana'][1]}",
                         headers=auth(people["carla"][0])).status_code == 403
    removed = client.delete(f"/api/plans/{plan_id}/members/{people['carla'][1]}",
                            headers=auth(people["ana"][0]))
    assert removed.status_code == 200
    assert _get(client, people["ana"][0], plan_id).get_json()["plan"]["counts"]["invited"] == 0


def test_the_creator_cannot_leave_and_unknown_members_are_404(client, world):
    people, place_id = world
    plan_id = _create(client, people["ana"][0], place_id).get_json()["plan"]["id"]
    ana = auth(people["ana"][0])
    assert client.delete(f"/api/plans/{plan_id}/members/{people['ana'][1]}", headers=ana).status_code == 403
    assert client.delete(f"/api/plans/{plan_id}/members/{people['carla'][1]}", headers=ana).status_code == 404
    assert client.delete(f"/api/plans/{plan_id}/members/not-a-uuid", headers=ana).status_code == 404


# --- Bloqueos ---------------------------------------------------------------------


def test_blocked_people_are_hidden_from_each_other(client, world):
    people, place_id = world
    plan_id = _create(client, people["ana"][0], place_id,
                      user_ids=[people["beto"][1], people["carla"][1]]).get_json()["plan"]["id"]

    # carla bloquea a beto: ella deja de ver a beto entre los integrantes (y a la inversa).
    client.post("/api/users/me/blocks", json={"user_id": people["beto"][1]},
                headers=auth(people["carla"][0]))

    for viewer, hidden in (("carla", "beto"), ("beto", "carla")):
        members = _get(client, people[viewer][0], plan_id).get_json()["plan"]["members"]
        assert people[hidden][1] not in {m["id"] for m in members}


def test_a_plan_from_someone_you_blocked_is_not_listed(client, world):
    people, place_id = world
    plan_id = _create(client, people["ana"][0], place_id,
                      user_ids=[people["beto"][1]]).get_json()["plan"]["id"]
    assert [p["id"] for p in client.get("/api/plans", headers=auth(people["beto"][0])
                                        ).get_json()["plans"]] == [plan_id]

    client.post("/api/users/me/blocks", json={"user_id": people["ana"][1]},
                headers=auth(people["beto"][0]))

    assert client.get("/api/plans", headers=auth(people["beto"][0])).get_json() == {"plans": []}


# --- Límite de uso, exportación y borrado --------------------------------------------


def test_writes_are_rate_limited_per_account(client, world, monkeypatch):
    from app.domain.rate_limiting import policy
    from app.domain.rate_limiting.policy import RateLimitRule

    people, place_id = world
    monkeypatch.setattr(policy, "PLAN_WRITE", RateLimitRule("plan_write", 2, 3600, clear_on_success=False))
    assert _create(client, people["ana"][0], place_id).status_code == 201
    assert _create(client, people["ana"][0], place_id).status_code == 201
    assert _create(client, people["ana"][0], place_id).status_code == 429
    # otra cuenta no se ve afectada.
    assert _create(client, people["beto"][0], place_id).status_code == 201


def test_data_export_includes_plans_without_other_peoples_data(client, app, world):
    import json

    people, place_id = world
    _create(client, people["ana"][0], place_id, note="Llevo juegos",
            user_ids=[people["beto"][1]])

    from app.infrastructure.persistence.repositories.data_export_repository import (
        SQLAlchemyDataExportRepository,
    )

    with app.app_context():
        data = SQLAlchemyDataExportRepository().collect_user_data(people["beto"][1])
    plans = data["place_plans"]
    assert plans == [{
        "place": "Café Aurora", "title": "Café el sábado", "note": "Llevo juegos",
        "starts_at": plans[0]["starts_at"], "status": "active", "role": "member",
        "my_response": "invited", "going_count": 1,
    }]
    assert people["ana"][1] not in json.dumps(plans)


def test_deleting_the_creator_removes_the_plan(client, app, world):
    people, place_id = world
    _create(client, people["ana"][0], place_id, user_ids=[people["beto"][1]])
    with app.app_context():
        db.session.execute(text("DELETE FROM users WHERE id = :i"), {"i": people["ana"][1]})
        db.session.commit()
    assert _count(app) == 0
    assert _count(app, "place_plan_members") == 0
    assert client.get("/api/plans", headers=auth(people["beto"][0])).get_json() == {"plans": []}


# --- Amistades ------------------------------------------------------------------------


def test_list_my_friends(client, world):
    people, _ = world
    response = client.get("/api/users/me/friends", headers=auth(people["ana"][0]))

    assert response.status_code == 200
    friends = response.get_json()["friends"]
    # beto y carla se siguen mutuamente con ana; dani solo la sigue a ella.
    assert [f["id"] for f in friends] == [people["beto"][1], people["carla"][1]]
    assert all(set(f) == {"id", "username", "name", "avatar_url"} for f in friends)
    assert client.get("/api/users/me/friends", headers=auth(people["dani"][0])).get_json() == {
        "friends": []
    }
    assert client.get("/api/users/me/friends").status_code == 401


def test_blocking_removes_a_friend_from_the_list(client, world):
    people, _ = world
    client.post("/api/users/me/blocks", json={"user_id": people["beto"][1]},
                headers=auth(people["ana"][0]))
    friends = client.get("/api/users/me/friends", headers=auth(people["ana"][0])).get_json()["friends"]
    assert [f["id"] for f in friends] == [people["carla"][1]]
