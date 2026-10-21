# GET /api/users/search?q= — buscar personas por nombre o usuario, tengan o no publicaciones.
# Las exclusiones (uno mismo, bloqueos, moderación, suspendidas) viven en el repositorio de búsqueda
# que ya usa Tero; aquí se comprueba que el endpoint las respeta y que no exige actividad previa.

from app.extensions import db
from app.infrastructure.persistence.models import User
from tests.test_content_preferences import _h, _register_and_login


def _search(client, token, q, **params):
    return client.get("/api/users/search", query_string={"q": q, **params}, headers=_h(token))


def _usernames(client, token, q, **params):
    return [u["username"] for u in _search(client, token, q, **params).get_json()["users"]]


def _set(app, user_id, **fields):
    with app.app_context():
        user = db.session.get(User, user_id)
        for key, value in fields.items():
            setattr(user, key, value)
        db.session.commit()


class TestUserSearch:
    def test_finds_a_person_who_never_posted(self, client):
        viewer, _ = _register_and_login(client, "viewer")
        _register_and_login(client, "sinposts")

        assert "sinposts" in _usernames(client, viewer, "sinposts")

    def test_finds_by_name_and_by_username_ignoring_case(self, client):
        viewer, _ = _register_and_login(client, "viewer")
        _register_and_login(client, "maria_lopez")

        assert "maria_lopez" in _usernames(client, viewer, "MARIA")  # nombre «Maria_lopez»
        assert "maria_lopez" in _usernames(client, viewer, "lopez")  # usuario

    def test_a_leading_at_sign_is_ignored(self, client):
        viewer, _ = _register_and_login(client, "viewer")
        _register_and_login(client, "arroba")

        assert "arroba" in _usernames(client, viewer, "@arroba")

    def test_the_result_has_only_the_reduced_public_shape(self, client):
        viewer, _ = _register_and_login(client, "viewer")
        _register_and_login(client, "forma")

        person = _search(client, viewer, "forma").get_json()["users"][0]

        assert set(person) == {"id", "name", "username", "is_private", "avatar_url"}

    def test_never_returns_the_viewer(self, client):
        viewer, _ = _register_and_login(client, "yomismo")

        assert _usernames(client, viewer, "yomismo") == []

    def test_empty_query_returns_an_empty_list(self, client):
        viewer, _ = _register_and_login(client, "viewer")

        for q in ("", "   ", "@"):
            response = _search(client, viewer, q)
            assert response.status_code == 200
            assert response.get_json() == {"users": []}

    def test_percent_and_underscore_are_searched_literally(self, client):
        viewer, _ = _register_and_login(client, "viewer")
        _register_and_login(client, "ab_cd")
        _register_and_login(client, "abxcd")

        assert _usernames(client, viewer, "ab_cd") == ["ab_cd"]
        assert _usernames(client, viewer, "%") == []

    def test_prefix_matches_come_first(self, client):
        viewer, _ = _register_and_login(client, "viewer")
        _register_and_login(client, "zeta_ana")
        _register_and_login(client, "ana_zeta")

        assert _usernames(client, viewer, "ana")[0] == "ana_zeta"

    def test_limit_caps_the_results(self, client):
        viewer, _ = _register_and_login(client, "viewer")
        for i in range(4):
            _register_and_login(client, f"tope{i}")

        assert len(_usernames(client, viewer, "tope", limit=2)) == 2

    def test_a_non_numeric_limit_is_a_400(self, client):
        viewer, _ = _register_and_login(client, "viewer")

        assert _search(client, viewer, "a", limit="mucho").status_code == 400

    def test_moderators_and_suspended_accounts_are_not_found(self, app, client):
        viewer, _ = _register_and_login(client, "viewer")
        _, mod_id = _register_and_login(client, "equipo_mod")
        _, sus_id = _register_and_login(client, "equipo_sus")
        _register_and_login(client, "equipo_ok")
        _set(app, mod_id, is_moderator=True)
        _set(app, sus_id, suspended_at=db.func.now())

        assert _usernames(client, viewer, "equipo") == ["equipo_ok"]

    def test_requires_a_session(self, client):
        assert client.get("/api/users/search", query_string={"q": "a"}).status_code == 401
