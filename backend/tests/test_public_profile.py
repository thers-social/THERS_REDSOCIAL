# Perfil de otra persona: GET /api/users/<id> y GET /api/posts?author_id= (ADR-049), contra
# PostgreSQL real (thers_test, ver conftest.py).

from tests.test_saved_and_shared_posts import _h, _post, _register_and_login


def _profile(client, token, user_id):
    return client.get(f"/api/users/{user_id}", headers=_h(token))


class TestPublicProfile:
    def test_returns_only_public_fields_and_relationship(self, client):
        token_a, _ = _register_and_login(client, "ada")
        _, bob_id = _register_and_login(client, "bob")

        response = _profile(client, token_a, bob_id)

        assert response.status_code == 200
        user = response.get_json()["user"]
        assert user["id"] == bob_id and user["username"] == "bob"
        assert user["follow_status"] is None
        assert user["can_view_posts"] is True
        assert user["followers_count"] == 0
        for private in ("email", "phone", "birth_date", "country_code", "has_password"):
            assert private not in user

    def test_follow_status_follows_the_viewer(self, client):
        token_a, _ = _register_and_login(client, "ada")
        _, bob_id = _register_and_login(client, "bob")

        client.post(f"/api/users/{bob_id}/follow", headers=_h(token_a))

        user = _profile(client, token_a, bob_id).get_json()["user"]
        assert user["follow_status"] == "accepted"
        assert user["followers_count"] == 1

    def test_private_account_hides_posts_until_followed(self, client):
        token_a, _ = _register_and_login(client, "ada")
        token_b, bob_id = _register_and_login(client, "bob")
        client.patch("/api/users/me/privacy", json={"is_private": True}, headers=_h(token_b))

        assert _profile(client, token_a, bob_id).get_json()["user"]["can_view_posts"] is False

        client.post(f"/api/users/{bob_id}/follow", headers=_h(token_a))
        # Solicitud pendiente: pedir no es seguir.
        pending = _profile(client, token_a, bob_id).get_json()["user"]
        assert pending["follow_status"] == "pending" and pending["can_view_posts"] is False

        client.post("/api/follow-requests/" + _me(client, token_a) + "/accept", headers=_h(token_b))
        assert _profile(client, token_a, bob_id).get_json()["user"]["can_view_posts"] is True

    def test_own_profile_has_no_follow_status(self, client):
        token_a, ada_id = _register_and_login(client, "ada")

        user = _profile(client, token_a, ada_id).get_json()["user"]

        assert user["follow_status"] is None and user["can_view_posts"] is True

    def test_blocked_in_either_direction_is_404(self, client):
        token_a, ada_id = _register_and_login(client, "ada")
        token_b, bob_id = _register_and_login(client, "bob")
        client.post("/api/users/me/blocks", json={"user_id": bob_id}, headers=_h(token_a))

        assert _profile(client, token_a, bob_id).status_code == 404
        assert _profile(client, token_b, ada_id).status_code == 404

    def test_unknown_or_malformed_id_is_404(self, client):
        token_a, _ = _register_and_login(client, "ada")

        assert _profile(client, token_a, "00000000-0000-4000-8000-000000000000").status_code == 404
        assert _profile(client, token_a, "no-es-uuid").status_code == 404

    def test_requires_authentication(self, client):
        _, bob_id = _register_and_login(client, "bob")

        assert client.get(f"/api/users/{bob_id}").status_code == 401


class TestPostsByAuthor:
    def test_only_that_authors_posts(self, client):
        token_a, _ = _register_and_login(client, "ada")
        token_b, bob_id = _register_and_login(client, "bob")
        _post(client, token_a, "de ada")
        bob_post = _post(client, token_b, "de bob")

        posts = client.get(f"/api/posts?author_id={bob_id}", headers=_h(token_a)).get_json()["posts"]

        assert [p["id"] for p in posts] == [bob_post]

    def test_private_author_posts_stay_hidden(self, client):
        token_a, _ = _register_and_login(client, "ada")
        token_b, bob_id = _register_and_login(client, "bob")
        client.patch("/api/users/me/privacy", json={"is_private": True}, headers=_h(token_b))
        _post(client, token_b, "secreto")

        posts = client.get(f"/api/posts?author_id={bob_id}", headers=_h(token_a)).get_json()["posts"]

        assert posts == []

    def test_malformed_author_id_is_400(self, client):
        token_a, _ = _register_and_login(client, "ada")

        assert client.get("/api/posts?author_id=x", headers=_h(token_a)).status_code == 400


def _me(client, token):
    return client.get("/api/users/me", headers=_h(token)).get_json()["user"]["id"]
