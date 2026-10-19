# Pruebas de integración de las publicaciones solo para mejores amigos (ADR-054) contra PostgreSQL
# real. Comparten los ayudantes de `test_close_friends.py` y `test_stories.py`.

import pytest

from tests.test_close_friends import _add, _remove
from tests.test_messages import _auth_headers, _register_and_login
from tests.test_stories import _users


@pytest.fixture(autouse=True)
def _stories_on(app):
    """Mejores amigos comparte el interruptor de las historias (apagado por defecto)."""
    app.config["STORIES_ENABLED"] = True


def _post(client, token, content="hola", audience=None):
    body = {"content": content}
    if audience is not None:
        body["audience"] = audience
    return client.post("/api/posts", json=body, headers=_auth_headers(token))


def _feed(client, token, author_id=None):
    url = "/api/posts" + (f"?author_id={author_id}" if author_id else "")
    return client.get(url, headers=_auth_headers(token)).get_json()["posts"]


def _ids(posts):
    return {post["id"] for post in posts}


def _third(client):
    return _register_and_login(client, username="user_c", email="c@example.com")


class TestCreate:
    def test_defaults_to_everyone(self, client):
        token_a, *_ = _users(client)

        response = _post(client, token_a)

        assert response.status_code == 201
        assert response.get_json()["post"]["audience"] == "everyone"

    def test_publishes_for_close_friends(self, client):
        token_a, *_ = _users(client)

        response = _post(client, token_a, audience="close_friends")

        assert response.status_code == 201
        assert response.get_json()["post"]["audience"] == "close_friends"

    def test_rejects_unknown_audience(self, client):
        token_a, *_ = _users(client)

        assert _post(client, token_a, audience="nobody").status_code == 400

    def test_rejects_close_friends_when_module_is_off(self, client, app):
        token_a, *_ = _users(client)
        app.config["STORIES_ENABLED"] = False

        assert _post(client, token_a, audience="close_friends").status_code == 400


class TestVisibility:
    def test_only_friends_and_author_see_it_in_the_feed(self, client):
        token_a, id_a, token_b, id_b = _users(client)
        token_c, _id_c = _third(client)
        _add(client, token_a, id_b)
        post_id = _post(client, token_a, audience="close_friends").get_json()["post"]["id"]

        assert post_id in _ids(_feed(client, token_a))
        assert post_id in _ids(_feed(client, token_b))
        assert post_id not in _ids(_feed(client, token_c))
        assert post_id not in _ids(_feed(client, token_c, author_id=id_a))

    def test_removing_a_friend_hides_what_was_already_published(self, client):
        token_a, _id_a, token_b, id_b = _users(client)
        _add(client, token_a, id_b)
        post_id = _post(client, token_a, audience="close_friends").get_json()["post"]["id"]
        assert post_id in _ids(_feed(client, token_b))

        _remove(client, token_a, id_b)

        assert post_id not in _ids(_feed(client, token_b))

    def test_everyone_posts_are_unaffected(self, client):
        token_a, _id_a, token_b, _id_b = _users(client)
        post_id = _post(client, token_a, audience="everyone").get_json()["post"]["id"]

        assert post_id in _ids(_feed(client, token_b))

    def test_non_friend_cannot_open_the_thread_like_comment_or_save(self, client):
        token_a, _id_a, token_b, _id_b = _users(client)
        post_id = _post(client, token_a, audience="close_friends").get_json()["post"]["id"]
        headers = _auth_headers(token_b)

        assert client.get(f"/api/posts/{post_id}/comments", headers=headers).status_code == 404
        assert client.post(f"/api/posts/{post_id}/like", headers=headers).status_code == 404
        assert (
            client.post(
                f"/api/posts/{post_id}/comments", json={"content": "hola"}, headers=headers
            ).status_code
            == 404
        )
        assert client.post(f"/api/posts/{post_id}/save", headers=headers).status_code == 404

    def test_friend_can_like_and_comment(self, client):
        token_a, _id_a, token_b, id_b = _users(client)
        _add(client, token_a, id_b)
        post_id = _post(client, token_a, audience="close_friends").get_json()["post"]["id"]
        headers = _auth_headers(token_b)

        assert client.post(f"/api/posts/{post_id}/like", headers=headers).status_code == 200
        assert (
            client.post(
                f"/api/posts/{post_id}/comments", json={"content": "hola"}, headers=headers
            ).status_code
            == 201
        )

    def test_a_non_friend_is_not_mentioned_in_a_close_friends_post(self, client):
        token_a, _id_a, _token_b, id_b = _users(client)
        _token_c, id_c = _third(client)
        _add(client, token_a, id_b)

        mentions = _post(
            client, token_a, content="hola @user_b y @user_c", audience="close_friends"
        ).get_json()["post"]["mentions"]

        assert {m["username"] for m in mentions} == {"user_b"}
