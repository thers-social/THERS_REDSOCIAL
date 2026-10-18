# Pruebas de integración de las preferencias de contenido y feed (REF-SET-12,
# ADR-030-content-preferences.md) contra PostgreSQL real (thers_test).
#
# Lo que importa es que cada preferencia CAMBIE lo que devuelve el feed en el
# servidor, no solo que el endpoint guarde un valor.

from tests.conftest import mark_email_verified, reset_rate_limits

VALID_PASSWORD = "secretpass"


def _register_and_login(client, username):
    email = f"{username}@example.com"
    response = client.post(
        "/api/register",
        json={
            "name": username.capitalize(),
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
    token = client.post(
        "/api/login", json={"email": email, "password": VALID_PASSWORD}
    ).get_json()["token"]
    return token, user_id


def _h(token):
    return {"Authorization": f"Bearer {token}"}


def _post(client, token, content, **extra):
    return client.post("/api/posts", json={"content": content, **extra}, headers=_h(token))


def _feed(client, token):
    return [p["content"] for p in client.get("/api/posts", headers=_h(token)).get_json()["posts"]]


# ---------------------------------------------------------------------------
# Contenido sensible
# ---------------------------------------------------------------------------
class TestSensitiveContent:
    def test_post_defaults_to_not_sensitive(self, client):
        token, _ = _register_and_login(client, "ada")
        post = _post(client, token, "hola").get_json()["post"]
        assert post["is_sensitive"] is False

    def test_author_can_mark_a_post_as_sensitive(self, client):
        token, _ = _register_and_login(client, "ada")
        post = _post(client, token, "hola", is_sensitive=True).get_json()["post"]
        assert post["is_sensitive"] is True

        listed = client.get("/api/posts", headers=_h(token)).get_json()["posts"][0]
        assert listed["is_sensitive"] is True

    def test_is_sensitive_must_be_a_real_boolean(self, client):
        token, _ = _register_and_login(client, "ada")
        # "false" como texto es verdadero en Python: no se acepta.
        assert _post(client, token, "hola", is_sensitive="false").status_code == 400
        assert _post(client, token, "hola", is_sensitive=1).status_code == 400

    def test_privacy_setting_defaults_to_off_and_is_persisted(self, client):
        token, _ = _register_and_login(client, "ada")
        privacy = client.get("/api/users/me/privacy", headers=_h(token)).get_json()["privacy"]
        assert privacy["hide_sensitive_content"] is False

        response = client.patch(
            "/api/users/me/privacy", json={"hide_sensitive_content": True}, headers=_h(token)
        )
        assert response.status_code == 200
        assert response.get_json()["privacy"]["hide_sensitive_content"] is True

    def test_setting_rejects_non_boolean(self, client):
        token, _ = _register_and_login(client, "ada")
        response = client.patch(
            "/api/users/me/privacy", json={"hide_sensitive_content": "true"}, headers=_h(token)
        )
        assert response.status_code == 400

    def test_off_by_default_everyone_sees_sensitive_posts(self, client):
        ta, _ = _register_and_login(client, "ada")
        tb, _ = _register_and_login(client, "bob")
        _post(client, ta, "delicado", is_sensitive=True)
        assert _feed(client, tb) == ["delicado"]

    def test_enabling_the_filter_hides_sensitive_posts_from_the_feed(self, client):
        ta, _ = _register_and_login(client, "ada")
        tb, _ = _register_and_login(client, "bob")
        _post(client, ta, "delicado", is_sensitive=True)
        _post(client, ta, "normal")

        client.patch(
            "/api/users/me/privacy", json={"hide_sensitive_content": True}, headers=_h(tb)
        )
        assert _feed(client, tb) == ["normal"]
        # Y no afecta a quien no activó el filtro.
        assert set(_feed(client, ta)) == {"delicado", "normal"}

    def test_own_sensitive_posts_are_never_hidden_from_their_author(self, client):
        token, _ = _register_and_login(client, "ada")
        client.patch(
            "/api/users/me/privacy", json={"hide_sensitive_content": True}, headers=_h(token)
        )
        _post(client, token, "mi post delicado", is_sensitive=True)
        assert _feed(client, token) == ["mi post delicado"]

    def test_disabling_the_filter_restores_the_posts(self, client):
        ta, _ = _register_and_login(client, "ada")
        tb, _ = _register_and_login(client, "bob")
        _post(client, ta, "delicado", is_sensitive=True)
        client.patch("/api/users/me/privacy", json={"hide_sensitive_content": True}, headers=_h(tb))
        client.patch("/api/users/me/privacy", json={"hide_sensitive_content": False}, headers=_h(tb))
        assert _feed(client, tb) == ["delicado"]


# ---------------------------------------------------------------------------
# Temas silenciados
# ---------------------------------------------------------------------------
class TestMutedTopics:
    def test_endpoints_require_authentication(self, client):
        assert client.get("/api/users/me/muted-topics").status_code == 401
        assert client.post("/api/users/me/muted-topics", json={}).status_code == 401
        assert client.delete("/api/users/me/muted-topics", json={}).status_code == 401

    def test_add_list_and_remove(self, client):
        token, _ = _register_and_login(client, "ada")
        assert client.get("/api/users/me/muted-topics", headers=_h(token)).get_json() == {
            "muted_topics": []
        }

        added = client.post("/api/users/me/muted-topics", json={"topic": "viajes"}, headers=_h(token))
        assert added.status_code == 200
        assert added.get_json()["muted_topics"] == ["viajes"]

        removed = client.delete(
            "/api/users/me/muted-topics", json={"topic": "viajes"}, headers=_h(token)
        )
        assert removed.status_code == 200
        assert removed.get_json()["muted_topics"] == []

    def test_hash_and_case_are_normalized(self, client):
        token, _ = _register_and_login(client, "ada")
        result = client.post(
            "/api/users/me/muted-topics", json={"topic": "  #Viajes "}, headers=_h(token)
        ).get_json()
        assert result["muted_topics"] == ["viajes"]

    def test_add_is_idempotent(self, client):
        token, _ = _register_and_login(client, "ada")
        client.post("/api/users/me/muted-topics", json={"topic": "viajes"}, headers=_h(token))
        again = client.post(
            "/api/users/me/muted-topics", json={"topic": "#VIAJES"}, headers=_h(token)
        )
        assert again.status_code == 200
        assert again.get_json()["muted_topics"] == ["viajes"]

    def test_invalid_topics_are_rejected(self, client):
        token, _ = _register_and_login(client, "ada")
        for bad in ["", "   ", "#", "dos palabras", "con-guion", "a" * 51, 123, None]:
            response = client.post(
                "/api/users/me/muted-topics", json={"topic": bad}, headers=_h(token)
            )
            assert response.status_code == 400, bad

    def test_remove_unknown_topic_is_404(self, client):
        token, _ = _register_and_login(client, "ada")
        response = client.delete(
            "/api/users/me/muted-topics", json={"topic": "nada"}, headers=_h(token)
        )
        assert response.status_code == 404

    def test_lists_are_private_to_their_owner(self, client):
        ta, _ = _register_and_login(client, "ada")
        tb, _ = _register_and_login(client, "bob")
        client.post("/api/users/me/muted-topics", json={"topic": "viajes"}, headers=_h(ta))
        assert client.get("/api/users/me/muted-topics", headers=_h(tb)).get_json() == {
            "muted_topics": []
        }

    def test_topic_limit_is_enforced_but_repeats_are_allowed(self, client):
        token, _ = _register_and_login(client, "ada")
        for i in range(50):
            assert client.post(
                "/api/users/me/muted-topics", json={"topic": f"tema{i}"}, headers=_h(token)
            ).status_code == 200

        assert client.post(
            "/api/users/me/muted-topics", json={"topic": "uno_mas"}, headers=_h(token)
        ).status_code == 409
        # Repetir uno existente no choca con el tope.
        assert client.post(
            "/api/users/me/muted-topics", json={"topic": "tema0"}, headers=_h(token)
        ).status_code == 200

    def test_muted_topic_hides_matching_posts_from_the_feed(self, client):
        ta, _ = _register_and_login(client, "ada")
        tb, _ = _register_and_login(client, "bob")
        _post(client, ta, "Mi viaje a la playa #viajes")
        _post(client, ta, "Cena de anoche #comida")

        client.post("/api/users/me/muted-topics", json={"topic": "viajes"}, headers=_h(tb))

        assert _feed(client, tb) == ["Cena de anoche #comida"]
        # No afecta a quien no silenció nada.
        assert len(_feed(client, ta)) == 2

    def test_match_is_the_whole_tag_not_a_prefix(self, client):
        ta, _ = _register_and_login(client, "ada")
        tb, _ = _register_and_login(client, "bob")
        _post(client, ta, "post con #viajes largos")
        _post(client, ta, "post con #viaje corto")
        client.post("/api/users/me/muted-topics", json={"topic": "viaje"}, headers=_h(tb))

        # `#viaje` oculta `#viaje` pero NO `#viajes`.
        assert _feed(client, tb) == ["post con #viajes largos"]

    def test_match_is_case_insensitive_and_works_at_text_boundaries(self, client):
        ta, _ = _register_and_login(client, "ada")
        tb, _ = _register_and_login(client, "bob")
        _post(client, ta, "#VIAJES al principio")
        _post(client, ta, "al final #Viajes")
        _post(client, ta, "con puntuación, #viajes.")
        _post(client, ta, "sin etiqueta: viajes")
        client.post("/api/users/me/muted-topics", json={"topic": "viajes"}, headers=_h(tb))

        assert _feed(client, tb) == ["sin etiqueta: viajes"]

    def test_accented_topics_work(self, client):
        ta, _ = _register_and_login(client, "ada")
        tb, _ = _register_and_login(client, "bob")
        _post(client, ta, "buen día #música")
        client.post("/api/users/me/muted-topics", json={"topic": "#Música"}, headers=_h(tb))
        assert _feed(client, tb) == []

    def test_own_posts_are_never_hidden_by_my_muted_topics(self, client):
        token, _ = _register_and_login(client, "ada")
        client.post("/api/users/me/muted-topics", json={"topic": "viajes"}, headers=_h(token))
        _post(client, token, "mi viaje #viajes")
        assert _feed(client, token) == ["mi viaje #viajes"]

    def test_removing_the_topic_restores_the_posts(self, client):
        ta, _ = _register_and_login(client, "ada")
        tb, _ = _register_and_login(client, "bob")
        _post(client, ta, "mi viaje #viajes")
        client.post("/api/users/me/muted-topics", json={"topic": "viajes"}, headers=_h(tb))
        client.delete("/api/users/me/muted-topics", json={"topic": "viajes"}, headers=_h(tb))
        assert _feed(client, tb) == ["mi viaje #viajes"]

    def test_muted_keywords_still_work_alongside_topics(self, client):
        # Las palabras ocultas (ADR-024) no se tocan: siguen filtrando por
        # subcadena, y conviven con los temas.
        ta, _ = _register_and_login(client, "ada")
        tb, _ = _register_and_login(client, "bob")
        _post(client, ta, "hay spoilers de la serie")
        _post(client, ta, "viaje #viajes")
        _post(client, ta, "post inocente")
        client.post("/api/users/me/muted-keywords", json={"keyword": "spoiler"}, headers=_h(tb))
        client.post("/api/users/me/muted-topics", json={"topic": "viajes"}, headers=_h(tb))
        assert _feed(client, tb) == ["post inocente"]


# ---------------------------------------------------------------------------
# Cuentas sugeridas
# ---------------------------------------------------------------------------
class TestSuggestions:
    def test_requires_authentication(self, client):
        assert client.get("/api/users/suggestions").status_code == 401

    def test_suggests_real_accounts_excluding_self(self, client):
        ta, id_a = _register_and_login(client, "ada")
        _register_and_login(client, "bob")
        _register_and_login(client, "carol")

        suggestions = client.get("/api/users/suggestions", headers=_h(ta)).get_json()["suggestions"]
        usernames = {s["username"] for s in suggestions}
        assert usernames == {"bob", "carol"}
        assert id_a not in {s["id"] for s in suggestions}

    def test_exposes_only_the_reduced_shape(self, client):
        ta, _ = _register_and_login(client, "ada")
        _register_and_login(client, "bob")
        suggestion = client.get("/api/users/suggestions", headers=_h(ta)).get_json()["suggestions"][0]
        assert set(suggestion) == {"id", "name", "username", "is_private", "avatar_url"}

    def test_limit_is_optional_and_validated(self, client):
        ta, _ = _register_and_login(client, "ada")
        for name in ("bob", "carol", "dave"):
            _register_and_login(client, name)
        assert len(client.get("/api/users/suggestions?limit=2", headers=_h(ta)).get_json()["suggestions"]) == 2
        assert client.get("/api/users/suggestions?limit=x", headers=_h(ta)).status_code == 400

    def test_excludes_accounts_already_followed_or_requested(self, client):
        ta, _ = _register_and_login(client, "ada")
        _, id_b = _register_and_login(client, "bob")
        _, id_c = _register_and_login(client, "carol")
        client.post(f"/api/users/{id_b}/follow", headers=_h(ta))

        usernames = {
            s["username"]
            for s in client.get("/api/users/suggestions", headers=_h(ta)).get_json()["suggestions"]
        }
        assert usernames == {"carol"}

    def test_private_account_with_pending_request_is_also_excluded(self, client):
        ta, _ = _register_and_login(client, "ada")
        tb, id_b = _register_and_login(client, "bob")
        client.patch("/api/users/me/privacy", json={"is_private": True}, headers=_h(tb))
        client.post(f"/api/users/{id_b}/follow", headers=_h(ta))

        assert client.get("/api/users/suggestions", headers=_h(ta)).get_json()["suggestions"] == []

    def test_excludes_blocked_accounts_in_both_directions(self, client):
        ta, id_a = _register_and_login(client, "ada")
        tb, id_b = _register_and_login(client, "bob")
        tc, id_c = _register_and_login(client, "carol")
        client.post("/api/users/me/blocks", json={"user_id": id_b}, headers=_h(ta))  # ada bloquea a bob
        client.post("/api/users/me/blocks", json={"user_id": id_a}, headers=_h(tc))  # carol bloquea a ada

        assert client.get("/api/users/suggestions", headers=_h(ta)).get_json()["suggestions"] == []
        # Y bob tampoco ve a ada (ella lo bloqueó).
        usernames = {
            s["username"]
            for s in client.get("/api/users/suggestions", headers=_h(tb)).get_json()["suggestions"]
        }
        assert "ada" not in usernames

    def test_most_followed_first(self, client):
        ta, _ = _register_and_login(client, "ada")
        tb, id_b = _register_and_login(client, "bob")
        tc, id_c = _register_and_login(client, "carol")
        td, id_d = _register_and_login(client, "dave")
        # carol tiene 2 seguidores, bob 1.
        client.post(f"/api/users/{id_c}/follow", headers=_h(tb))
        client.post(f"/api/users/{id_c}/follow", headers=_h(td))
        client.post(f"/api/users/{id_b}/follow", headers=_h(td))

        order = [
            s["username"]
            for s in client.get("/api/users/suggestions", headers=_h(ta)).get_json()["suggestions"]
        ]
        assert order[0] == "carol"
        assert order[1] == "bob"

    def test_limited_to_five(self, client, app):
        ta, _ = _register_and_login(client, "ada")
        for i in range(8):
            if i == 3:
                # Registrar nueve cuentas supera el límite de registros por
                # hora (ADR-027). Se reinicia el contador en vez de subir el
                # límite: ese número protege producción.
                with app.app_context():
                    reset_rate_limits()
            _register_and_login(client, f"user{i}")
        suggestions = client.get("/api/users/suggestions", headers=_h(ta)).get_json()["suggestions"]
        assert len(suggestions) == 5
