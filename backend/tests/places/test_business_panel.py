# Panel de negocio (ADR-040 fase 7): solo gestores de UN lugar editan su ficha (lista blanca),
# ven cifras y responden reseñas; moderadores y demás personas reciben 404.

import pytest
from sqlalchemy import text

from app.extensions import db
from tests.places.helpers import auth, insert_place, make_users

MISSING = "00000000-0000-4000-8000-000000000000"


def _scalar(app, sql, **params):
    with app.app_context():
        return db.session.execute(text(sql), params).scalar()


@pytest.fixture()
def world(app, client):
    users = make_users(app, client, with_moderator=True)
    with app.app_context():
        place_id = insert_place("Café Aurora", description="Café de barrio", phone="22223333")
        other_id = insert_place("Otro lugar")
        db.session.execute(
            text("INSERT INTO place_managers (place_id, user_id) VALUES (:p, :u)"),
            {"p": place_id, "u": users["ana"][1]},
        )
        db.session.commit()
    # beto deja una reseña.
    client.put(
        f"/api/places/{place_id}/review", json={"rating": 4, "body": "Muy rico"},
        headers=auth(users["beto"][0]),
    )
    review_id = client.get(f"/api/places/{place_id}/reviews", headers=auth(users["ana"][0])).get_json()[
        "reviews"
    ][0]["id"]
    return users, place_id, other_id, review_id


def _reply_url(place_id, review_id):
    return f"/api/places/{place_id}/reviews/{review_id}/reply"


# --- Acceso ----------------------------------------------------------------


def test_routes_need_a_session(client, world):
    _, place_id, _, review_id = world
    for method, path in (
        ("get", "/api/users/me/managed-places"), ("get", f"/api/places/{place_id}/manage"),
        ("patch", f"/api/places/{place_id}/manage"), ("put", _reply_url(place_id, review_id)),
        ("delete", _reply_url(place_id, review_id)),
    ):
        assert getattr(client, method)(path).status_code == 401


def test_only_the_manager_of_that_place_gets_in(client, world):
    users, place_id, other_id, review_id = world
    for token in (users["beto"][0], users["mod"][0]):  # ni otra persona ni moderación
        headers = auth(token)
        assert client.get(f"/api/places/{place_id}/manage", headers=headers).status_code == 404
        assert client.patch(f"/api/places/{place_id}/manage", json={"phone": "1234567"}, headers=headers).status_code == 404
        assert client.put(_reply_url(place_id, review_id), json={"body": "hola"}, headers=headers).status_code == 404
    # Gestionar un lugar no da acceso a otro.
    assert client.get(f"/api/places/{other_id}/manage", headers=auth(users["ana"][0])).status_code == 404
    assert client.get(f"/api/places/{MISSING}/manage", headers=auth(users["ana"][0])).status_code == 404


def test_list_managed_places(client, world):
    users, place_id, _, _ = world
    mine = client.get("/api/users/me/managed-places", headers=auth(users["ana"][0])).get_json()["places"]
    assert [p["id"] for p in mine] == [place_id]
    assert mine[0]["reviews_count"] == 1 and mine[0]["is_public"] is True
    assert client.get("/api/users/me/managed-places", headers=auth(users["beto"][0])).get_json() == {"places": []}


# --- Panel y edición ------------------------------------------------------------


def test_panel_shows_editable_data_and_stats(client, world):
    users, place_id, _, _ = world
    client.post(f"/api/places/{place_id}/save", headers=auth(users["beto"][0]))

    body = client.get(f"/api/places/{place_id}/manage", headers=auth(users["ana"][0])).get_json()
    assert body["place"]["name"] == "Café Aurora"
    assert body["stats"] == {
        "saves": 1, "reviews": 1, "rating_average": 4.0, "reviews_without_reply": 1, "upcoming_plans": 0,
    }


def test_manager_edits_only_whitelisted_fields_and_it_is_audited(client, app, world):
    users, place_id, _, _ = world
    response = client.patch(
        f"/api/places/{place_id}/manage",
        json={
            "description": "  Café y pupusas  ", "phone": "2222-4444", "website": "https://aurora.example",
            "address": "Calle 1",
            # Todo esto es de moderación y se ignora:
            "name": "Hackeado", "category": "bares", "latitude": 1, "longitude": 1,
            "verification_status": "pending", "is_active": False,
        },
        headers=auth(users["ana"][0]),
    )

    assert response.status_code == 200
    place = response.get_json()["place"]
    assert place["description"] == "Café y pupusas"
    assert place["phone"] == "2222-4444" and place["website"] == "https://aurora.example"
    assert place["name"] == "Café Aurora"
    assert _scalar(app, "SELECT is_active FROM places WHERE id = :p", p=place_id) is True
    assert _scalar(app, "SELECT verification_status FROM places WHERE id = :p", p=place_id) == "verified"
    assert _scalar(
        app, "SELECT count(*) FROM admin_audit_log WHERE action = 'place_updated' AND actor_id = :a",
        a=users["ana"][1],
    ) == 1


@pytest.mark.parametrize(
    "payload",
    [
        {}, {"name": "solo moderación"}, {"phone": "abc"}, {"website": "javascript:alert(1)"},
        {"description": "x" * 2001}, {"address": "x" * 256},
    ],
)
def test_invalid_edits_are_rejected(client, app, world, payload):
    users, place_id, _, _ = world
    response = client.patch(f"/api/places/{place_id}/manage", json=payload, headers=auth(users["ana"][0]))
    assert response.status_code == 400
    assert _scalar(app, "SELECT description FROM places WHERE id = :p", p=place_id) == "Café de barrio"


def test_edits_are_rate_limited(client, world, monkeypatch):
    from app.domain.rate_limiting import policy
    from app.domain.rate_limiting.policy import RateLimitRule

    monkeypatch.setattr(policy, "BUSINESS_WRITE", RateLimitRule("business_write", 1, 3600, clear_on_success=False))
    users, place_id, _, _ = world
    headers = auth(users["ana"][0])
    assert client.patch(f"/api/places/{place_id}/manage", json={"phone": "2222-4444"}, headers=headers).status_code == 200
    assert client.patch(f"/api/places/{place_id}/manage", json={"phone": "2222-5555"}, headers=headers).status_code == 429


# --- Respuestas a reseñas -----------------------------------------------------------


def test_reply_to_a_review_is_public(client, world):
    users, place_id, _, review_id = world
    response = client.put(
        _reply_url(place_id, review_id), json={"body": "  ¡Gracias por venir!  "}, headers=auth(users["ana"][0])
    )
    assert response.status_code == 200
    assert response.get_json()["reply"]["body"] == "¡Gracias por venir!"

    # La ve cualquiera que lea las reseñas, también sin sesión.
    for headers in (auth(users["beto"][0]), {}):
        reviews = client.get(f"/api/places/{place_id}/reviews", headers=headers).get_json()["reviews"]
        assert reviews[0]["reply"]["body"] == "¡Gracias por venir!"
    assert client.get(f"/api/places/{place_id}/manage", headers=auth(users["ana"][0])).get_json()["stats"][
        "reviews_without_reply"
    ] == 0


def test_reply_can_be_edited_and_removed(client, app, world):
    users, place_id, _, review_id = world
    headers = auth(users["ana"][0])
    client.put(_reply_url(place_id, review_id), json={"body": "uno"}, headers=headers)
    client.put(_reply_url(place_id, review_id), json={"body": "dos"}, headers=headers)
    assert _scalar(app, "SELECT count(*) FROM place_review_replies") == 1
    assert _scalar(app, "SELECT body FROM place_review_replies") == "dos"

    assert client.delete(_reply_url(place_id, review_id), headers=headers).status_code == 200
    assert client.delete(_reply_url(place_id, review_id), headers=headers).status_code == 404
    reviews = client.get(f"/api/places/{place_id}/reviews", headers=headers).get_json()["reviews"]
    assert reviews[0]["reply"] is None


@pytest.mark.parametrize("body", [None, "", "   ", 5, "x" * 501, "mal\x00"])
def test_invalid_replies_are_rejected(client, world, body):
    users, place_id, _, review_id = world
    response = client.put(_reply_url(place_id, review_id), json={"body": body}, headers=auth(users["ana"][0]))
    assert response.status_code == 400


def test_reply_needs_a_visible_review_of_that_place(client, app, world):
    users, place_id, other_id, review_id = world
    headers = auth(users["ana"][0])
    assert client.put(_reply_url(place_id, MISSING), json={"body": "hola"}, headers=headers).status_code == 404
    # Reseña de otro lugar: no se puede responder desde este.
    with app.app_context():
        db.session.execute(
            text("INSERT INTO place_managers (place_id, user_id) VALUES (:p, :u)"),
            {"p": other_id, "u": users["mod"][1]},
        )
        db.session.commit()
    assert client.put(_reply_url(other_id, review_id), json={"body": "hola"}, headers=auth(users["mod"][0])).status_code == 404
    # Reseña oculta por moderación: tampoco.
    with app.app_context():
        db.session.execute(text("UPDATE place_reviews SET is_hidden = true"))
        db.session.commit()
    assert client.put(_reply_url(place_id, review_id), json={"body": "hola"}, headers=headers).status_code == 404


def test_identity_comes_from_the_token(client, app, world):
    users, place_id, _, review_id = world
    client.put(
        _reply_url(place_id, review_id), json={"body": "hola", "author_id": users["beto"][1]},
        headers=auth(users["ana"][0]),
    )
    assert _scalar(app, "SELECT author_id::text FROM place_review_replies") == users["ana"][1]


def test_replies_go_away_with_the_review(client, app, world):
    users, place_id, _, review_id = world
    client.put(_reply_url(place_id, review_id), json={"body": "hola"}, headers=auth(users["ana"][0]))
    client.delete(f"/api/places/{place_id}/review", headers=auth(users["beto"][0]))
    assert _scalar(app, "SELECT count(*) FROM place_review_replies") == 0
