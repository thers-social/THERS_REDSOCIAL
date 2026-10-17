# Pruebas de reseñas de THERS Places (ADR-040, fase 4a): escribir, editar, borrar, listar,
# promedio, validación, bloqueos, moderación, límite de uso, exportación y borrado de cuenta.

import pytest
from sqlalchemy import text

from app.domain.rate_limiting import policy
from app.extensions import db
from tests.places.helpers import REF_LNG, auth, insert_place, make_users, north_of_reference

MISSING = "00000000-0000-4000-8000-000000000000"


def _count(app, where="TRUE", **params):
    with app.app_context():
        return db.session.execute(
            text(f"SELECT count(*) FROM place_reviews WHERE {where}"), params
        ).scalar()


def _put(client, token, place_id, body):
    return client.put(f"/api/places/{place_id}/review", json=body, headers=auth(token))


@pytest.fixture()
def setup(app, client):
    users = make_users(app, client, with_moderator=True)
    with app.app_context():
        place_id = insert_place("Café Aurora", lat=north_of_reference(300), lng=REF_LNG)
    return users, place_id


# --- Escribir --------------------------------------------------------------


def test_write_a_review(client, app, setup):
    users, place_id = setup
    token, user_id = users["ana"]

    response = _put(client, token, place_id, {"rating": 5, "body": "  Excelente café  "})

    assert response.status_code == 201
    review = response.get_json()["review"]
    assert review["rating"] == 5
    assert review["body"] == "Excelente café"
    assert review["place_id"] == place_id
    assert _count(app, "user_id = :u", u=user_id) == 1


def test_writing_again_updates_instead_of_duplicating(client, app, setup):
    users, place_id = setup
    token, user_id = users["ana"]
    _put(client, token, place_id, {"rating": 2, "body": "Regular"})

    response = _put(client, token, place_id, {"rating": 4, "body": "Mejoró"})

    assert response.status_code == 200
    assert response.get_json()["review"]["rating"] == 4
    assert _count(app, "user_id = :u", u=user_id) == 1


def test_body_is_optional(client, setup):
    users, place_id = setup
    response = _put(client, users["ana"][0], place_id, {"rating": 3})
    assert response.status_code == 201
    assert response.get_json()["review"]["body"] is None


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"rating": 0},
        {"rating": 6},
        {"rating": -1},
        {"rating": 4.5},
        {"rating": "4"},
        {"rating": True},
        {"rating": None},
        {"rating": 3, "body": 123},
        {"rating": 3, "body": "x" * 1001},
        {"rating": 3, "body": "hola\x00mundo"},
    ],
)
def test_invalid_reviews_are_rejected(client, app, setup, payload):
    users, place_id = setup
    response = _put(client, users["ana"][0], place_id, payload)
    assert response.status_code == 400
    assert "msg" in response.get_json()
    assert _count(app) == 0


def test_non_object_body_is_rejected(client, setup):
    users, place_id = setup
    response = client.put(
        f"/api/places/{place_id}/review", json=[1, 2], headers=auth(users["ana"][0])
    )
    assert response.status_code == 400


def test_review_requires_a_session(client, setup):
    _, place_id = setup
    assert client.put(f"/api/places/{place_id}/review", json={"rating": 5}).status_code == 401
    assert client.delete(f"/api/places/{place_id}/review").status_code == 401


def test_cannot_review_a_missing_or_non_public_place(client, app, setup):
    users, _ = setup
    token = users["ana"][0]
    with app.app_context():
        pending = insert_place("Pendiente", status="pending")
        inactive = insert_place("Inactivo", active=False)
    for place_id in (MISSING, pending, inactive):
        assert _put(client, token, place_id, {"rating": 5}).status_code == 404
    assert client.put("/api/places/not-a-uuid/review", json={"rating": 5}, headers=auth(token)).status_code == 404
    assert _count(app) == 0


def test_body_cannot_set_identity_or_visibility(client, app, setup):
    users, place_id = setup
    token, user_id = users["ana"]
    other = users["beto"][1]

    _put(client, token, place_id, {"rating": 5, "user_id": other, "is_hidden": True})

    assert _count(app, "user_id = :u AND NOT is_hidden", u=user_id) == 1
    assert _count(app, "user_id = :u", u=other) == 0


# --- Borrar ----------------------------------------------------------------


def test_delete_own_review(client, app, setup):
    users, place_id = setup
    token, _ = users["ana"]
    _put(client, token, place_id, {"rating": 5})

    response = client.delete(f"/api/places/{place_id}/review", headers=auth(token))

    assert response.status_code == 200
    assert response.get_json() == {"deleted": True}
    assert _count(app) == 0


def test_delete_without_a_review_is_404_and_never_touches_others(client, app, setup):
    users, place_id = setup
    _put(client, users["ana"][0], place_id, {"rating": 5})

    response = client.delete(f"/api/places/{place_id}/review", headers=auth(users["beto"][0]))

    assert response.status_code == 404
    assert _count(app) == 1


# --- Listar y promedio ------------------------------------------------------


def test_list_is_public_and_has_summary(client, setup):
    users, place_id = setup
    _put(client, users["ana"][0], place_id, {"rating": 5, "body": "Genial"})
    _put(client, users["beto"][0], place_id, {"rating": 2})

    response = client.get(f"/api/places/{place_id}/reviews")

    assert response.status_code == 200
    body = response.get_json()
    assert body["summary"] == {"average": 3.5, "count": 2}
    assert body["has_more"] is False
    assert len(body["reviews"]) == 2
    first = body["reviews"][0]
    assert set(first["author"]) == {"id", "username", "name", "avatar_url"}
    assert first["is_mine"] is False
    assert "hidden" not in first


def test_list_never_leaks_private_author_data(client, setup):
    users, place_id = setup
    _put(client, users["ana"][0], place_id, {"rating": 5})
    raw = client.get(f"/api/places/{place_id}/reviews").get_data(as_text=True)
    for forbidden in ("email", "password", "phone", "birth_date"):
        assert forbidden not in raw


def test_own_review_comes_first_and_is_marked(client, setup):
    users, place_id = setup
    _put(client, users["ana"][0], place_id, {"rating": 5})
    _put(client, users["beto"][0], place_id, {"rating": 1})

    reviews = client.get(f"/api/places/{place_id}/reviews", headers=auth(users["ana"][0])).get_json()["reviews"]

    assert reviews[0]["is_mine"] is True
    assert reviews[0]["rating"] == 5
    assert reviews[1]["is_mine"] is False


def test_pagination(client, setup):
    users, place_id = setup
    _put(client, users["ana"][0], place_id, {"rating": 5})
    _put(client, users["beto"][0], place_id, {"rating": 4})

    page = client.get(f"/api/places/{place_id}/reviews?limit=1").get_json()
    assert len(page["reviews"]) == 1 and page["has_more"] is True
    assert client.get(f"/api/places/{place_id}/reviews?limit=0").status_code == 400
    assert client.get(f"/api/places/{place_id}/reviews?offset=-1").status_code == 400


def test_list_of_missing_or_non_public_place_is_404(client, app, setup):
    with app.app_context():
        pending = insert_place("Pendiente", status="pending")
    assert client.get(f"/api/places/{MISSING}/reviews").status_code == 404
    assert client.get(f"/api/places/{pending}/reviews").status_code == 404


def test_place_summary_and_detail_expose_real_rating(client, setup):
    users, place_id = setup
    detail = client.get(f"/api/places/{place_id}").get_json()["place"]
    assert detail["rating_average"] is None
    assert detail["reviews_count"] == 0

    _put(client, users["ana"][0], place_id, {"rating": 4})
    _put(client, users["beto"][0], place_id, {"rating": 5})

    detail = client.get(f"/api/places/{place_id}").get_json()["place"]
    assert detail["rating_average"] == 4.5
    assert detail["reviews_count"] == 2
    listed = client.get("/api/places").get_json()["places"][0]
    assert listed["rating_average"] == 4.5 and listed["reviews_count"] == 2


# --- Bloqueos ---------------------------------------------------------------


def test_blocked_authors_are_hidden_in_both_directions(client, setup):
    users, place_id = setup
    ana, _ = users["ana"]
    beto, beto_id = users["beto"]
    _put(client, beto, place_id, {"rating": 1})

    assert client.post("/api/users/me/blocks", json={"user_id": beto_id}, headers=auth(ana)).status_code in (200, 201)

    assert client.get(f"/api/places/{place_id}/reviews", headers=auth(ana)).get_json()["reviews"] == []
    # Y beto tampoco ve lo de ana si ella reseña (bloqueo en cualquier sentido).
    _put(client, ana, place_id, {"rating": 5})
    beto_view = client.get(f"/api/places/{place_id}/reviews", headers=auth(beto)).get_json()["reviews"]
    assert [r["is_mine"] for r in beto_view] == [True]


# --- Moderación -------------------------------------------------------------


def _review_id(app, user_id):
    with app.app_context():
        return str(db.session.execute(text("SELECT id FROM place_reviews WHERE user_id = :u"), {"u": user_id}).scalar())


def test_moderator_can_hide_and_restore_a_review_with_audit(client, app, setup):
    users, place_id = setup
    _put(client, users["ana"][0], place_id, {"rating": 1, "body": "Spam"})
    review_id = _review_id(app, users["ana"][1])
    mod = users["mod"][0]

    hidden = client.post(
        f"/api/moderation/places/reviews/{review_id}/visibility",
        json={"hidden": True, "note": "Spam"},
        headers=auth(mod),
    )

    assert hidden.status_code == 200
    # Fuera del listado público, del promedio y del conteo; su autora sí la ve marcada.
    public = client.get(f"/api/places/{place_id}/reviews").get_json()
    assert public["reviews"] == [] and public["summary"] == {"average": None, "count": 0}
    own = client.get(f"/api/places/{place_id}/reviews", headers=auth(users["ana"][0])).get_json()
    assert own["reviews"][0]["hidden"] is True
    assert client.get(f"/api/places/{place_id}").get_json()["place"]["reviews_count"] == 0

    restored = client.post(
        f"/api/moderation/places/reviews/{review_id}/visibility",
        json={"hidden": False},
        headers=auth(mod),
    )
    assert restored.status_code == 200
    assert client.get(f"/api/places/{place_id}/reviews").get_json()["summary"]["count"] == 1
    with app.app_context():
        actions = [
            r[0]
            for r in db.session.execute(
                text("SELECT action FROM admin_audit_log WHERE resource_type = 'place_review' ORDER BY created_at")
            )
        ]
    assert actions == ["place_review_hidden", "place_review_restored"]


def test_non_moderators_get_404_on_review_moderation(client, app, setup):
    users, place_id = setup
    _put(client, users["ana"][0], place_id, {"rating": 3})
    review_id = _review_id(app, users["ana"][1])
    url = f"/api/moderation/places/reviews/{review_id}/visibility"

    assert client.post(url, json={"hidden": True}, headers=auth(users["beto"][0])).status_code == 404
    assert client.post(url, json={"hidden": True}).status_code in (401, 404)
    assert _count(app, "is_hidden") == 0


def test_moderation_validates_input(client, app, setup):
    users, place_id = setup
    _put(client, users["ana"][0], place_id, {"rating": 3})
    review_id = _review_id(app, users["ana"][1])
    mod = users["mod"][0]
    url = f"/api/moderation/places/reviews/{review_id}/visibility"

    assert client.post(url, json={"hidden": "yes"}, headers=auth(mod)).status_code == 400
    assert client.post(url, json={}, headers=auth(mod)).status_code == 400
    assert client.post(url, json=[1], headers=auth(mod)).status_code == 400
    missing = f"/api/moderation/places/reviews/{MISSING}/visibility"
    assert client.post(missing, json={"hidden": True}, headers=auth(mod)).status_code == 404


# --- Límite de uso y datos personales ---------------------------------------


def test_reviews_are_rate_limited_per_account(client, setup):
    users, place_id = setup
    ana, _ = users["ana"]
    for _ in range(policy.PLACE_REVIEW.limit):
        assert _put(client, ana, place_id, {"rating": 4}).status_code in (200, 201)
    limited = _put(client, ana, place_id, {"rating": 4})
    assert limited.status_code == 429 and "Retry-After" in limited.headers
    assert _put(client, users["beto"][0], place_id, {"rating": 4}).status_code == 201


def test_deleting_the_account_removes_reviews_but_keeps_the_place(client, app, setup):
    users, place_id = setup
    token, user_id = users["ana"]
    _put(client, token, place_id, {"rating": 5})

    with app.app_context():
        db.session.execute(text("DELETE FROM users WHERE id = :u"), {"u": user_id})
        db.session.commit()

    assert _count(app) == 0
    assert client.get(f"/api/places/{place_id}").get_json()["place"]["reviews_count"] == 0


def test_data_export_includes_own_reviews_only(client, app, setup):
    from app.infrastructure.persistence.repositories.data_export_repository import (
        SQLAlchemyDataExportRepository,
    )

    users, place_id = setup
    _put(client, users["ana"][0], place_id, {"rating": 5, "body": "Me encantó"})
    _put(client, users["beto"][0], place_id, {"rating": 1})

    with app.app_context():
        data = SQLAlchemyDataExportRepository().collect_user_data(users["ana"][1])

    assert [(r["place"], r["rating"], r["body"]) for r in data["place_reviews"]] == [
        ("Café Aurora", 5, "Me encantó")
    ]
