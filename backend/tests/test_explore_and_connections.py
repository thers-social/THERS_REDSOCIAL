# Explorar y listas de seguidores/seguidos (ADR-050) contra PostgreSQL real (thers_test).

from tests.test_post_message_images import _png, _post as _post_with_images, _upload
from tests.test_saved_and_shared_posts import _h, _post, _register_and_login


def _photo_post(client, token, content="foto"):
    response = _post_with_images(client, token, content, images=[_upload(_png())])
    assert response.status_code == 201
    return response.get_json()["post"]["id"]


def _explore(client, token, query=""):
    return client.get(f"/api/explore{query}", headers=_h(token))


def _ids(response):
    return [p["id"] for p in response.get_json()["posts"]]


class TestExplore:
    def test_shows_media_posts_of_people_you_do_not_follow(self, client):
        token_a, _ = _register_and_login(client, "ada")
        token_b, _ = _register_and_login(client, "bob")
        photo = _photo_post(client, token_b)
        _post(client, token_b, "solo texto")

        assert _ids(_explore(client, token_a)) == [photo]

    def test_excludes_own_and_followed_authors(self, client):
        token_a, _ = _register_and_login(client, "ada")
        token_b, bob_id = _register_and_login(client, "bob")
        _photo_post(client, token_a)
        _photo_post(client, token_b)

        client.post(f"/api/users/{bob_id}/follow", headers=_h(token_a))

        assert _ids(_explore(client, token_a)) == []

    def test_most_popular_first(self, client):
        token_a, _ = _register_and_login(client, "ada")
        token_b, _ = _register_and_login(client, "bob")
        token_c, _ = _register_and_login(client, "cleo")
        quiet = _photo_post(client, token_b, "tranquila")
        popular = _photo_post(client, token_c, "popular")
        client.post(f"/api/posts/{popular}/like", headers=_h(token_b))

        assert _ids(_explore(client, token_a)) == [popular, quiet]

    def test_kind_filter_and_validation(self, client):
        token_a, _ = _register_and_login(client, "ada")
        token_b, _ = _register_and_login(client, "bob")
        photo = _photo_post(client, token_b)

        assert _ids(_explore(client, token_a, "?kind=images")) == [photo]
        assert _ids(_explore(client, token_a, "?kind=videos")) == []
        assert _explore(client, token_a, "?kind=otro").status_code == 400
        assert _explore(client, token_a, "?offset=x").status_code == 400

    def test_private_and_blocked_authors_are_hidden(self, client):
        token_a, _ = _register_and_login(client, "ada")
        token_b, _ = _register_and_login(client, "bob")
        token_c, cleo_id = _register_and_login(client, "cleo")
        client.patch("/api/users/me/privacy", json={"is_private": True}, headers=_h(token_b))
        _photo_post(client, token_b)
        _photo_post(client, token_c)
        client.post("/api/users/me/blocks", json={"user_id": cleo_id}, headers=_h(token_a))

        assert _ids(_explore(client, token_a)) == []

    def test_requires_authentication(self, client):
        assert client.get("/api/explore").status_code == 401


class TestConnections:
    def test_lists_followers_and_following(self, client):
        token_a, ada_id = _register_and_login(client, "ada")
        token_b, bob_id = _register_and_login(client, "bob")
        client.post(f"/api/users/{bob_id}/follow", headers=_h(token_a))

        followers = client.get(f"/api/users/{bob_id}/followers", headers=_h(token_a)).get_json()["users"]
        following = client.get(f"/api/users/{ada_id}/following", headers=_h(token_b)).get_json()["users"]

        assert [u["username"] for u in followers] == ["ada"]
        assert followers[0]["is_me"] is True
        assert [u["username"] for u in following] == ["bob"]
        assert following[0]["is_me"] is True

    def test_private_account_list_needs_an_accepted_follow(self, client):
        token_a, ada_id = _register_and_login(client, "ada")
        token_b, bob_id = _register_and_login(client, "bob")
        client.patch("/api/users/me/privacy", json={"is_private": True}, headers=_h(token_b))

        assert client.get(f"/api/users/{bob_id}/followers", headers=_h(token_a)).status_code == 403
        assert client.get(f"/api/users/{bob_id}/followers", headers=_h(token_b)).status_code == 200

        client.post(f"/api/users/{bob_id}/follow", headers=_h(token_a))
        client.post(f"/api/follow-requests/{ada_id}/accept", headers=_h(token_b))
        assert client.get(f"/api/users/{bob_id}/followers", headers=_h(token_a)).status_code == 200

    def test_blocked_accounts_are_hidden_and_404(self, client):
        token_a, _ = _register_and_login(client, "ada")
        token_b, bob_id = _register_and_login(client, "bob")
        token_c, cleo_id = _register_and_login(client, "cleo")
        client.post(f"/api/users/{bob_id}/follow", headers=_h(token_c))
        client.post(f"/api/users/{bob_id}/follow", headers=_h(token_a))
        client.post("/api/users/me/blocks", json={"user_id": cleo_id}, headers=_h(token_a))

        names = [u["username"] for u in client.get(f"/api/users/{bob_id}/followers", headers=_h(token_a)).get_json()["users"]]
        assert names == ["ada"]
        assert client.get(f"/api/users/{cleo_id}/followers", headers=_h(token_a)).status_code == 404

    def test_pagination_and_validation(self, client):
        token_a, _ = _register_and_login(client, "ada")
        token_b, bob_id = _register_and_login(client, "bob")
        token_c, _ = _register_and_login(client, "cleo")
        client.post(f"/api/users/{bob_id}/follow", headers=_h(token_a))
        client.post(f"/api/users/{bob_id}/follow", headers=_h(token_c))

        first = client.get(f"/api/users/{bob_id}/followers?limit=1", headers=_h(token_a)).get_json()
        second = client.get(f"/api/users/{bob_id}/followers?limit=1&offset=1", headers=_h(token_a)).get_json()

        assert first["has_more"] is True and len(first["users"]) == 1
        assert first["users"][0]["id"] != second["users"][0]["id"]
        assert client.get(f"/api/users/{bob_id}/followers?limit=x", headers=_h(token_a)).status_code == 400
