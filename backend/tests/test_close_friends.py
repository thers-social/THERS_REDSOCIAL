# Pruebas de integración de «Mejores amigos» (ADR-054) contra PostgreSQL real: la lista y la
# audiencia de las historias. Comparten los ayudantes de `test_stories.py`.

import io
import uuid

import pytest

from tests.test_messages import _auth_headers, _register_and_login
from tests.test_stories import _follow, _png, _publish, _stored_files, _strip, _users


@pytest.fixture(autouse=True)
def _stories_on(app):
    """Mejores amigos comparte el interruptor de las historias (apagado por defecto)."""
    app.config["STORIES_ENABLED"] = True


def _list(client, token):
    return client.get("/api/close-friends", headers=_auth_headers(token))


def _add(client, token, user_id):
    return client.post(
        "/api/close-friends", json={"user_id": str(user_id)}, headers=_auth_headers(token)
    )


def _remove(client, token, user_id):
    return client.delete(f"/api/close-friends/{user_id}", headers=_auth_headers(token))


def _publish_to(client, token, audience, content="hola"):
    # `_publish` no sabe de `audience`: se arma la petición aquí con la misma imagen.
    return client.post(
        "/api/stories",
        data={"image": (io.BytesIO(_png()), "foto.png"), "content": content, "audience": audience},
        content_type="multipart/form-data",
        headers=_auth_headers(token),
    )


def _stories_of(client, token, author_id):
    return client.get(f"/api/users/{author_id}/stories", headers=_auth_headers(token)).get_json()[
        "stories"
    ]


class TestManageList:
    def test_starts_empty(self, client):
        token_a, *_ = _users(client)

        response = _list(client, token_a)

        assert response.status_code == 200
        assert response.get_json()["friends"] == []

    def test_adds_lists_and_removes_a_friend(self, client):
        token_a, _id_a, _token_b, id_b = _users(client)

        added = _add(client, token_a, id_b)
        listed = _list(client, token_a).get_json()["friends"]
        removed = _remove(client, token_a, id_b)

        assert added.status_code == 201 and added.get_json() == {"added": True}
        assert [f["id"] for f in listed] == [id_b]
        assert listed[0]["username"] == "user_b"
        assert "email" not in listed[0]
        assert removed.status_code == 200 and removed.get_json() == {"removed": True}
        assert _list(client, token_a).get_json()["friends"] == []

    def test_add_and_remove_are_idempotent(self, client):
        token_a, _id_a, _token_b, id_b = _users(client)

        _add(client, token_a, id_b)
        again = _add(client, token_a, id_b)
        _remove(client, token_a, id_b)
        removed_again = _remove(client, token_a, id_b)

        assert again.status_code == 200 and again.get_json() == {"added": False}
        assert removed_again.get_json() == {"removed": False}

    def test_the_list_is_private_and_one_directional(self, client):
        token_a, id_a, token_b, id_b = _users(client)

        _add(client, token_a, id_b)

        # B no ve que A lo añadió, y A no aparece en la lista de B.
        assert _list(client, token_b).get_json()["friends"] == []

    def test_cannot_add_yourself(self, client):
        token_a, id_a, *_ = _users(client)

        assert _add(client, token_a, id_a).status_code == 404

    def test_unknown_or_malformed_person_is_a_404(self, client):
        token_a, *_ = _users(client)

        assert _add(client, token_a, uuid.uuid4()).status_code == 404
        response = client.post(
            "/api/close-friends", json={"user_id": "no-es-un-uuid"}, headers=_auth_headers(token_a)
        )
        assert response.status_code == 404

    def test_user_id_is_required(self, client):
        token_a, *_ = _users(client)

        response = client.post("/api/close-friends", json={}, headers=_auth_headers(token_a))

        assert response.status_code == 400

    def test_a_blocked_person_cannot_be_added(self, client):
        token_a, _id_a, _token_b, id_b = _users(client)
        client.post(
            "/api/users/me/blocks", json={"username": "user_b"}, headers=_auth_headers(token_a)
        )

        assert _add(client, token_a, id_b).status_code == 404

    def test_the_list_has_a_limit(self, client, monkeypatch):
        from app.application.close_friends import close_friend_use_cases

        monkeypatch.setattr(close_friend_use_cases, "MAX_CLOSE_FRIENDS", 1)
        token_a, _id_a, _token_b, id_b = _users(client)
        _token_c, id_c = _register_and_login(client, username="user_c", email="c@example.com")

        first = _add(client, token_a, id_b)
        second = _add(client, token_a, id_c)

        assert first.status_code == 201
        assert second.status_code == 409

    def test_requires_a_session(self, client):
        assert client.get("/api/close-friends").status_code == 401
        assert client.post("/api/close-friends", json={"user_id": str(uuid.uuid4())}).status_code == 401

    def test_does_not_exist_with_stories_off(self, client, app):
        token_a, *_ = _users(client)
        app.config["STORIES_ENABLED"] = False

        assert _list(client, token_a).status_code == 404
        assert client.get("/api/close-friends").status_code == 404


class TestStoryAudience:
    def test_a_story_is_for_everyone_by_default(self, client):
        token_a, *_ = _users(client)

        story = _publish(client, token_a, "hola").get_json()["story"]

        assert story["audience"] == "everyone"

    def test_publishes_a_close_friends_story(self, client):
        token_a, *_ = _users(client)

        response = _publish_to(client, token_a, "close_friends")

        assert response.status_code == 201
        assert response.get_json()["story"]["audience"] == "close_friends"

    def test_an_invalid_audience_is_rejected_and_stores_nothing(self, client):
        token_a, *_ = _users(client)
        before = len(_stored_files())

        response = _publish_to(client, token_a, "todo-el-mundo")

        assert response.status_code == 400
        assert len(_stored_files()) == before

    def test_a_follower_outside_the_list_does_not_see_it(self, client):
        token_a, id_a, token_b, _id_b = _users(client)
        _follow(client, token_b, id_a)
        story_id = _publish_to(client, token_a, "close_friends").get_json()["story"]["id"]

        assert _strip(client, token_b) == []
        assert _stories_of(client, token_b, id_a) == []
        view = client.post(f"/api/stories/{story_id}/view", headers=_auth_headers(token_b))
        assert view.status_code == 404

    def test_a_friend_in_the_list_sees_it(self, client):
        token_a, id_a, token_b, id_b = _users(client)
        _follow(client, token_b, id_a)
        story_id = _publish_to(client, token_a, "close_friends").get_json()["story"]["id"]
        _add(client, token_a, id_b)

        strip = _strip(client, token_b)
        stories = _stories_of(client, token_b, id_a)
        view = client.post(f"/api/stories/{story_id}/view", headers=_auth_headers(token_b))

        assert [a["author"]["id"] for a in strip] == [id_a]
        assert strip[0]["has_close_friends"] is True
        assert [s["id"] for s in stories] == [story_id]
        assert stories[0]["audience"] == "close_friends"
        assert view.status_code == 200

    def test_removing_a_friend_takes_the_stories_away(self, client):
        token_a, id_a, token_b, id_b = _users(client)
        _follow(client, token_b, id_a)
        _publish_to(client, token_a, "close_friends")
        _add(client, token_a, id_b)
        assert len(_stories_of(client, token_b, id_a)) == 1

        _remove(client, token_a, id_b)

        assert _stories_of(client, token_b, id_a) == []
        assert _strip(client, token_b) == []

    def test_being_in_the_list_is_not_enough_without_following(self, client):
        token_a, id_a, token_b, id_b = _users(client)
        _publish_to(client, token_a, "close_friends")
        _add(client, token_a, id_b)

        # B no sigue a A: la regla de ADR-042 sigue mandando.
        assert _stories_of(client, token_b, id_a) == []
        assert _strip(client, token_b) == []

    def test_the_author_always_sees_their_own(self, client):
        token_a, id_a, *_ = _users(client)
        _publish_to(client, token_a, "close_friends")

        strip = _strip(client, token_a)

        assert [a["author"]["id"] for a in strip] == [id_a]
        assert strip[0]["has_close_friends"] is True
        assert len(_stories_of(client, token_a, id_a)) == 1

    def test_everyone_and_close_friends_stories_mix_per_viewer(self, client):
        token_a, id_a, token_b, id_b = _users(client)
        token_c, _id_c = _register_and_login(client, username="user_c", email="c@example.com")
        _follow(client, token_b, id_a)
        _follow(client, token_c, id_a)
        _publish(client, token_a, "para todos")
        _publish_to(client, token_a, "close_friends", "solo cercanos")
        _add(client, token_a, id_b)

        for_b = _strip(client, token_b)
        for_c = _strip(client, token_c)

        # B (en la lista) ve las dos; C (seguidor) solo la pública, y sin el anillo verde.
        assert for_b[0]["stories_count"] == 2 and for_b[0]["has_close_friends"] is True
        assert for_c[0]["stories_count"] == 1 and for_c[0]["has_close_friends"] is False
        assert [s["content"] for s in _stories_of(client, token_c, id_a)] == ["para todos"]

    def test_the_views_list_is_still_only_for_the_author(self, client):
        token_a, id_a, token_b, id_b = _users(client)
        _follow(client, token_b, id_a)
        story_id = _publish_to(client, token_a, "close_friends").get_json()["story"]["id"]
        _add(client, token_a, id_b)
        client.post(f"/api/stories/{story_id}/view", headers=_auth_headers(token_b))

        by_author = client.get(f"/api/stories/{story_id}/views", headers=_auth_headers(token_a))
        by_friend = client.get(f"/api/stories/{story_id}/views", headers=_auth_headers(token_b))

        assert by_author.status_code == 200
        assert by_author.get_json()["views_count"] == 1
        assert by_friend.status_code == 404
