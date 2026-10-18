# Guardar y compartir publicaciones (ADR-047) contra PostgreSQL real (thers_test, ver conftest.py).

from tests.conftest import mark_email_verified

VALID_PASSWORD = "secretpass"


def _register_and_login(client, username):
    email = f"{username}@example.com"
    response = client.post(
        "/api/register",
        json={
            "name": username.title(),
            "username": username,
            "email": email,
            "phone": "7000-1234",
            "country_code": "+503",
            "birth_date": "1990-01-01",
            "password": VALID_PASSWORD,
            "confirm_password": VALID_PASSWORD,
        },
    )
    user_id = response.get_json()["user"]["id"]
    mark_email_verified(user_id)
    token = client.post("/api/login", json={"email": email, "password": VALID_PASSWORD}).get_json()["token"]
    return token, user_id


def _h(token):
    return {"Authorization": f"Bearer {token}"}


def _post(client, token, content="una publicación", **extra):
    return client.post("/api/posts", json={"content": content, **extra}, headers=_h(token)).get_json()["post"]["id"]


def _save(client, token, post_id):
    return client.post(f"/api/posts/{post_id}/save", headers=_h(token))


def _saved(client, token):
    return client.get("/api/posts/saved", headers=_h(token)).get_json()["posts"]


def _share(client, token, to_id, post_id, **extra):
    return client.post(
        f"/api/users/{to_id}/messages", json={"post_id": post_id, **extra}, headers=_h(token)
    )


class TestSavePost:
    def test_save_and_list_marks_saved_by_me(self, client):
        token_a, _ = _register_and_login(client, "ada")
        token_b, _ = _register_and_login(client, "bob")
        post_id = _post(client, token_b)

        assert _save(client, token_a, post_id).get_json() == {"saved": True}
        posts = _saved(client, token_a)
        assert [p["id"] for p in posts] == [post_id]
        assert posts[0]["saved_by_me"] is True

    def test_feed_reports_saved_by_me_only_to_the_person_who_saved(self, client):
        token_a, _ = _register_and_login(client, "ada")
        token_b, _ = _register_and_login(client, "bob")
        post_id = _post(client, token_b)
        _save(client, token_a, post_id)

        mine = {p["id"]: p for p in client.get("/api/posts", headers=_h(token_a)).get_json()["posts"]}
        theirs = {p["id"]: p for p in client.get("/api/posts", headers=_h(token_b)).get_json()["posts"]}
        assert mine[post_id]["saved_by_me"] is True
        assert theirs[post_id]["saved_by_me"] is False
        assert _saved(client, token_b) == []

    def test_save_is_idempotent_and_does_not_notify(self, client):
        token_a, _ = _register_and_login(client, "ada")
        token_b, _ = _register_and_login(client, "bob")
        post_id = _post(client, token_b)
        assert _save(client, token_a, post_id).status_code == 200
        assert _save(client, token_a, post_id).status_code == 200
        assert len(_saved(client, token_a)) == 1
        notifications = client.get("/api/notifications", headers=_h(token_b)).get_json()["notifications"]
        assert notifications == []

    def test_unsave_removes_and_is_idempotent(self, client):
        token_a, _ = _register_and_login(client, "ada")
        token_b, _ = _register_and_login(client, "bob")
        post_id = _post(client, token_b)
        _save(client, token_a, post_id)
        response = client.delete(f"/api/posts/{post_id}/save", headers=_h(token_a))
        assert response.get_json() == {"saved": False}
        assert client.delete(f"/api/posts/{post_id}/save", headers=_h(token_a)).status_code == 200
        assert _saved(client, token_a) == []

    def test_most_recently_saved_first(self, client):
        token_a, _ = _register_and_login(client, "ada")
        token_b, _ = _register_and_login(client, "bob")
        first = _post(client, token_b, "primera")
        second = _post(client, token_b, "segunda")
        _save(client, token_a, second)
        _save(client, token_a, first)
        assert [p["id"] for p in _saved(client, token_a)] == [first, second]

    def test_requires_a_token_and_a_real_post(self, client):
        token_a, _ = _register_and_login(client, "ada")
        assert client.post("/api/posts/00000000-0000-0000-0000-000000000000/save").status_code == 401
        assert client.get("/api/posts/saved").status_code == 401
        assert _save(client, token_a, "00000000-0000-0000-0000-000000000000").status_code == 404
        assert client.post("/api/posts/no-es-uuid/save", headers=_h(token_a)).status_code == 404

    def test_cannot_save_a_private_account_post_without_following(self, client):
        token_a, _ = _register_and_login(client, "ada")
        token_b, _ = _register_and_login(client, "bob")
        post_id = _post(client, token_b)
        client.patch("/api/users/me/privacy", json={"is_private": True}, headers=_h(token_b))
        assert _save(client, token_a, post_id).status_code == 404

    def test_a_saved_post_disappears_when_the_account_turns_private_and_can_be_unsaved(self, client):
        token_a, _ = _register_and_login(client, "ada")
        token_b, _ = _register_and_login(client, "bob")
        post_id = _post(client, token_b)
        _save(client, token_a, post_id)
        client.patch("/api/users/me/privacy", json={"is_private": True}, headers=_h(token_b))
        assert _saved(client, token_a) == []
        assert client.delete(f"/api/posts/{post_id}/save", headers=_h(token_a)).status_code == 200

    def test_blocked_either_way_hides_and_forbids(self, client):
        token_a, _ = _register_and_login(client, "ada")
        token_b, id_b = _register_and_login(client, "bob")
        post_id = _post(client, token_b)
        _save(client, token_a, post_id)
        client.post("/api/users/me/blocks", json={"user_id": id_b}, headers=_h(token_a))
        assert _saved(client, token_a) == []
        assert _save(client, token_a, post_id).status_code == 404

    def test_deleting_the_post_deletes_the_saved_row(self, client):
        token_a, _ = _register_and_login(client, "ada")
        token_b, _ = _register_and_login(client, "bob")
        post_id = _post(client, token_b)
        _save(client, token_a, post_id)
        client.delete(f"/api/posts/{post_id}", headers=_h(token_b))
        assert _saved(client, token_a) == []


class TestSharePost:
    def test_shares_a_post_with_a_card_for_both_people(self, client):
        token_a, id_a = _register_and_login(client, "ada")
        token_b, id_b = _register_and_login(client, "bob")
        token_c, _ = _register_and_login(client, "cleo")
        post_id = _post(client, token_c, "Un texto que se resume en la tarjeta")

        response = _share(client, token_a, id_b, post_id, content="mira esto")
        assert response.status_code == 201
        card = response.get_json()["message"]["post"]
        assert card["available"] is True
        assert card["id"] == post_id
        assert card["author"]["username"] == "cleo"
        assert card["excerpt"] == "Un texto que se resume en la tarjeta"

        thread = client.get(f"/api/users/{id_a}/messages", headers=_h(token_b)).get_json()["messages"]
        assert thread[-1]["post"]["id"] == post_id
        assert thread[-1]["content"] == "mira esto"

    def test_text_is_optional_when_sharing(self, client):
        token_a, _ = _register_and_login(client, "ada")
        token_b, id_b = _register_and_login(client, "bob")
        post_id = _post(client, token_b)
        _, id_c = _register_and_login(client, "cleo")
        assert _share(client, token_a, id_c, post_id).status_code == 201

    def test_a_normal_message_has_no_post_card(self, client):
        token_a, _ = _register_and_login(client, "ada")
        _, id_b = _register_and_login(client, "bob")
        message = client.post(f"/api/users/{id_b}/messages", json={"content": "hola"}, headers=_h(token_a)).get_json()["message"]
        assert message["post"] is None

    def test_cannot_share_a_post_you_cannot_see(self, client):
        token_a, _ = _register_and_login(client, "ada")
        token_b, _ = _register_and_login(client, "bob")
        _, id_c = _register_and_login(client, "cleo")
        post_id = _post(client, token_b)
        client.patch("/api/users/me/privacy", json={"is_private": True}, headers=_h(token_b))
        assert _share(client, token_a, id_c, post_id).status_code == 404

    def test_the_card_is_unavailable_to_someone_who_cannot_see_the_post(self, client):
        token_a, id_a = _register_and_login(client, "ada")
        token_b, id_b = _register_and_login(client, "bob")
        token_c, id_c = _register_and_login(client, "cleo")
        post_id = _post(client, token_a, "texto privado")
        # Ada comparte su propia publicación con Bob y luego se vuelve privada: Bob no la sigue.
        _share(client, token_a, id_b, post_id)
        client.patch("/api/users/me/privacy", json={"is_private": True}, headers=_h(token_a))
        thread = client.get(f"/api/users/{id_a}/messages", headers=_h(token_b)).get_json()["messages"]
        assert thread[-1]["post"] == {"id": post_id, "available": False}
        # Ada, su autora, sigue viéndola.
        mine = client.get(f"/api/users/{id_b}/messages", headers=_h(token_a)).get_json()["messages"]
        assert mine[-1]["post"]["available"] is True

    def test_deleted_post_leaves_the_message_with_an_unavailable_card(self, client):
        token_a, id_a = _register_and_login(client, "ada")
        token_b, id_b = _register_and_login(client, "bob")
        post_id = _post(client, token_a)
        _share(client, token_a, id_b, post_id, content="ten")
        client.delete(f"/api/posts/{post_id}", headers=_h(token_a))
        thread = client.get(f"/api/users/{id_a}/messages", headers=_h(token_b)).get_json()["messages"]
        assert len(thread) == 1
        assert thread[0]["post"] is None

    def test_sensitive_post_card_hides_text_from_others(self, client):
        token_a, _ = _register_and_login(client, "ada")
        token_b, id_b = _register_and_login(client, "bob")
        post_id = _post(client, token_a, "contenido delicado", is_sensitive=True)
        card = _share(client, token_a, id_b, post_id).get_json()["message"]["post"]
        assert card["excerpt"] == "contenido delicado"  # su propia autora
        token_c, id_c = _register_and_login(client, "cleo")
        card = _share(client, token_b, id_c, post_id).get_json()["message"]["post"]
        assert card["is_sensitive"] is True
        assert card["excerpt"] is None
        assert card["thumbnail_url"] is None

    def test_validation(self, client):
        token_a, _ = _register_and_login(client, "ada")
        _, id_b = _register_and_login(client, "bob")
        assert _share(client, token_a, id_b, "no-es-uuid").status_code == 400
        assert _share(client, token_a, id_b, 123).status_code == 400
        assert _share(client, token_a, id_b, "00000000-0000-0000-0000-000000000000").status_code == 404

    def test_conversation_list_flags_a_shared_post(self, client):
        token_a, id_a = _register_and_login(client, "ada")
        _, id_b = _register_and_login(client, "bob")
        post_id = _post(client, token_a)
        _share(client, token_a, id_b, post_id)
        conversations = client.get("/api/conversations", headers=_h(token_a)).get_json()["conversations"]
        assert conversations[0]["last_message"]["has_post"] is True

    def test_share_respects_blocks_and_message_permissions(self, client):
        token_a, id_a = _register_and_login(client, "ada")
        token_b, id_b = _register_and_login(client, "bob")
        post_id = _post(client, token_a)
        client.post("/api/users/me/blocks", json={"user_id": id_a}, headers=_h(token_b))
        assert _share(client, token_a, id_b, post_id).status_code == 404
