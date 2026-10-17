# Publicaciones asociadas a un lugar (ADR-040 fase 4d): `place_id` al publicar, la tarjeta del
# lugar en el feed y `GET /api/places/<id>/posts`. Cubre que solo se asocian lugares públicos y
# que listar por lugar NO es una forma de saltarse la visibilidad (cuentas privadas, bloqueos,
# contenido sensible, filtros).

import io

import pytest
from PIL import Image
from sqlalchemy import event, text

from app.extensions import db
from tests.places.helpers import auth, insert_place, make_users

MISSING = "00000000-0000-4000-8000-000000000000"


def _post(client, token, **body):
    return client.post("/api/posts", json=body, headers=auth(token))


def _at_place(client, token, place_id):
    return client.get(f"/api/places/{place_id}/posts", headers=auth(token))


@pytest.fixture()
def world(app, client):
    users = make_users(app, client)
    with app.app_context():
        place_id = insert_place("Café Aurora", municipality="San Salvador", department="San Salvador")
    return users, place_id


def test_publish_with_a_place(client, world):
    users, place_id = world

    response = _post(client, users["ana"][0], content="Gran café", place_id=place_id)

    assert response.status_code == 201
    place = response.get_json()["post"]["place"]
    assert place["id"] == place_id and place["available"] is True and place["name"] == "Café Aurora"
    assert set(place) == {"id", "available", "name", "category", "municipality", "department"}


def test_a_post_without_place_has_null_place(client, world):
    users, _ = world
    assert _post(client, users["ana"][0], content="Hola").get_json()["post"]["place"] is None


def test_unknown_or_non_public_places_are_404_and_nothing_is_published(client, app, world):
    users, _ = world
    with app.app_context():
        pending = insert_place("Pendiente", status="pending")
        inactive = insert_place("Inactivo", active=False)
    for place_id in (MISSING, pending, inactive):
        assert _post(client, users["ana"][0], content="x", place_id=place_id).status_code == 404
    with app.app_context():
        assert db.session.execute(text("SELECT count(*) FROM posts")).scalar() == 0


@pytest.mark.parametrize("bad", ["no-es-uuid", 123, ["x"], True])
def test_malformed_place_id_is_400(client, world, bad):
    users, _ = world
    assert _post(client, users["ana"][0], content="x", place_id=bad).status_code == 400


def test_the_feed_shows_the_place_card(client, world):
    users, place_id = world
    _post(client, users["ana"][0], content="Gran café", place_id=place_id)

    posts = client.get("/api/posts", headers=auth(users["beto"][0])).get_json()["posts"]

    assert posts[0]["place"]["name"] == "Café Aurora"


def test_list_posts_of_a_place(client, app, world):
    users, place_id = world
    with app.app_context():
        other = insert_place("Otro lugar")
    _post(client, users["ana"][0], content="en aurora", place_id=place_id)
    _post(client, users["beto"][0], content="en otro", place_id=other)
    _post(client, users["beto"][0], content="sin lugar")

    posts = _at_place(client, users["ana"][0], place_id).get_json()["posts"]

    assert [p["content"] for p in posts] == ["en aurora"]


def test_the_listing_needs_a_session_and_a_public_place(client, app, world):
    users, place_id = world
    assert client.get(f"/api/places/{place_id}/posts").status_code == 401
    assert _at_place(client, users["ana"][0], MISSING).status_code == 404
    with app.app_context():
        pending = insert_place("Pendiente", status="pending")
    assert _at_place(client, users["ana"][0], pending).status_code == 404


def test_newest_first(client, world):
    users, place_id = world
    _post(client, users["ana"][0], content="primero", place_id=place_id)
    _post(client, users["beto"][0], content="segundo", place_id=place_id)
    posts = _at_place(client, users["ana"][0], place_id).get_json()["posts"]
    assert [p["content"] for p in posts] == ["segundo", "primero"]


def test_private_accounts_are_not_exposed_through_the_place(client, world):
    users, place_id = world
    client.patch("/api/users/me/privacy", json={"is_private": True}, headers=auth(users["ana"][0]))
    _post(client, users["ana"][0], content="solo mis seguidores", place_id=place_id)

    assert _at_place(client, users["beto"][0], place_id).get_json()["posts"] == []
    # La propia autora sí lo ve.
    assert len(_at_place(client, users["ana"][0], place_id).get_json()["posts"]) == 1


def test_blocks_hide_posts_in_both_directions(client, world):
    users, place_id = world
    _post(client, users["ana"][0], content="hola", place_id=place_id)
    client.post("/api/users/me/blocks", json={"user_id": users["ana"][1]}, headers=auth(users["beto"][0]))

    assert _at_place(client, users["beto"][0], place_id).get_json()["posts"] == []
    assert _at_place(client, users["ana"][0], place_id).get_json()["posts"][0]["content"] == "hola"


def test_sensitive_and_muted_filters_still_apply(client, world):
    users, place_id = world
    beto = users["beto"][0]
    _post(client, users["ana"][0], content="contenido fuerte", place_id=place_id, is_sensitive=True)
    _post(client, users["ana"][0], content="una palabra prohibida", place_id=place_id)
    client.patch("/api/users/me/privacy", json={"hide_sensitive_content": True}, headers=auth(beto))
    client.post("/api/users/me/muted-keywords", json={"keyword": "prohibida"}, headers=auth(beto))

    assert _at_place(client, beto, place_id).get_json()["posts"] == []


def test_a_place_that_stops_being_public_shows_as_unavailable_in_the_feed(client, app, world):
    users, place_id = world
    _post(client, users["ana"][0], content="hola", place_id=place_id)
    with app.app_context():
        db.session.execute(text("UPDATE places SET verification_status = 'rejected'"))
        db.session.commit()

    card = client.get("/api/posts", headers=auth(users["beto"][0])).get_json()["posts"][0]["place"]

    assert card == {"id": place_id, "available": False}
    assert _at_place(client, users["beto"][0], place_id).status_code == 404


def test_a_deleted_place_keeps_the_post(client, app, world):
    users, place_id = world
    _post(client, users["ana"][0], content="hola", place_id=place_id)
    with app.app_context():
        db.session.execute(text("DELETE FROM places WHERE id = :p"), {"p": place_id})
        db.session.commit()

    post = client.get("/api/posts", headers=auth(users["beto"][0])).get_json()["posts"][0]

    assert post["content"] == "hola" and post["place"] is None


def test_a_photo_post_with_a_place(client, world):
    users, place_id = world
    out = io.BytesIO()
    Image.new("RGB", (40, 30), (10, 200, 10)).save(out, format="PNG")
    out.seek(0)

    response = client.post(
        "/api/posts",
        data={"content": "con foto", "place_id": place_id, "images": (out, "f.png")},
        content_type="multipart/form-data",
        headers=auth(users["ana"][0]),
    )

    assert response.status_code == 201
    post = response.get_json()["post"]
    assert post["place"]["id"] == place_id and len(post["images"]) == 1


def test_a_rejected_post_leaves_no_files(client, app, world):
    users, _ = world
    out = io.BytesIO()
    Image.new("RGB", (40, 30)).save(out, format="PNG")
    out.seek(0)
    response = client.post(
        "/api/posts",
        data={"content": "x", "place_id": MISSING, "images": (out, "f.png")},
        content_type="multipart/form-data",
        headers=auth(users["ana"][0]),
    )
    assert response.status_code == 404
    import os

    files = [n for _, _, names in os.walk(os.environ["UPLOAD_DIR"]) for n in names]
    assert files == []


def test_the_page_resolves_cards_in_one_query(client, app, world):
    users, _ = world
    with app.app_context():
        ids = [insert_place(f"Lugar {i}") for i in range(5)]
    for place_id in ids:
        _post(client, users["ana"][0], content="x", place_id=place_id)

    statements = []
    with app.app_context():
        event.listen(db.engine, "before_cursor_execute", lambda *a: statements.append(a[2]))
    client.get("/api/posts", headers=auth(users["beto"][0]))

    assert sum("FROM places" in s for s in statements) == 1


def test_editing_a_post_keeps_its_place(client, world):
    users, place_id = world
    post_id = _post(client, users["ana"][0], content="hola", place_id=place_id).get_json()["post"]["id"]

    edited = client.patch(f"/api/posts/{post_id}", json={"content": "hola otra vez"}, headers=auth(users["ana"][0]))

    assert edited.status_code == 200
    # La respuesta del propio PATCH lleva la tarjeta (no un "no disponible" falso).
    assert edited.get_json()["post"]["place"]["name"] == "Café Aurora"
    listing = _at_place(client, users["ana"][0], place_id).get_json()["posts"]
    assert listing[0]["content"] == "hola otra vez" and listing[0]["place"]["id"] == place_id
