# Chats grupales (ADR-048) contra PostgreSQL real (thers_test, ver conftest.py).

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


def _users(client, *names):
    return [_register_and_login(client, n) for n in names]


def _create(client, token, name, member_ids):
    return client.post("/api/groups", json={"name": name, "member_ids": member_ids}, headers=_h(token))


def _group(client, token, name, member_ids):
    return _create(client, token, name, member_ids).get_json()["group"]


def _say(client, token, group_id, text, **extra):
    return client.post(
        f"/api/groups/{group_id}/messages", json={"content": text, **extra}, headers=_h(token)
    )


def _thread(client, token, group_id):
    return client.get(f"/api/groups/{group_id}/messages", headers=_h(token))


class TestCreate:
    def test_creator_is_admin_and_members_are_listed(self, client):
        (ta, ida), (tb, idb), (tc, idc) = _users(client, "ada", "bob", "cyn")
        group = _group(client, ta, "  Los   amigos ", [idb, idc])

        assert group["name"] == "Los amigos"
        assert group["my_role"] == "admin"
        roles = {m["id"]: m["role"] for m in group["members"]}
        assert roles == {ida: "admin", idb: "member", idc: "member"}

    def test_needs_a_name_and_at_least_one_other_person(self, client):
        (ta, ida), (tb, idb) = _users(client, "ada", "bob")
        assert _create(client, ta, "", [idb]).status_code == 400
        assert _create(client, ta, "x" * 61, [idb]).status_code == 400
        assert _create(client, ta, "Solo yo", []).status_code == 400
        assert _create(client, ta, "Solo yo", [ida]).status_code == 400
        assert _create(client, ta, "Mal", ["no-es-uuid"]).status_code == 400

    def test_unknown_user_is_rejected(self, client):
        (ta, _) = _users(client, "ada")[0]
        response = _create(client, ta, "G", ["00000000-0000-4000-8000-000000000000"])
        assert response.status_code == 403

    def test_cannot_add_someone_who_blocked_you_or_who_does_not_accept_messages(self, client):
        (ta, ida), (tb, idb), (tc, idc) = _users(client, "ada", "bob", "cyn")
        client.post("/api/users/me/blocks", json={"user_id": ida}, headers=_h(tb))
        assert _create(client, ta, "G", [idb]).status_code == 403

        client.patch("/api/users/me/privacy", json={"who_can_message": "nobody"}, headers=_h(tc))
        assert _create(client, ta, "G", [idc]).status_code == 403

    def test_group_size_is_capped(self, client):
        (ta, _) = _users(client, "ada")[0]
        ids = ["00000000-0000-4000-8000-%012d" % i for i in range(60)]
        assert _create(client, ta, "Enorme", ids).status_code == 400


class TestMembership:
    def test_non_member_gets_404_everywhere(self, client):
        (ta, _), (tb, idb), (tz, _) = _users(client, "ada", "bob", "zed")
        group = _group(client, ta, "Privado", [idb])
        gid = group["id"]

        assert client.get(f"/api/groups/{gid}", headers=_h(tz)).status_code == 404
        assert _thread(client, tz, gid).status_code == 404
        assert _say(client, tz, gid, "hola").status_code == 404
        assert client.post(f"/api/groups/{gid}/leave", headers=_h(tz)).status_code == 404
        assert client.get("/api/groups", headers=_h(tz)).get_json()["groups"] == []

    def test_only_admins_rename_add_and_remove(self, client):
        (ta, _), (tb, idb), (tc, idc) = _users(client, "ada", "bob", "cyn")
        gid = _group(client, ta, "G", [idb])["id"]

        assert client.patch(f"/api/groups/{gid}", json={"name": "X"}, headers=_h(tb)).status_code == 403
        assert client.post(f"/api/groups/{gid}/members", json={"user_ids": [idc]}, headers=_h(tb)).status_code == 403

        renamed = client.patch(f"/api/groups/{gid}", json={"name": "Nuevo"}, headers=_h(ta))
        assert renamed.get_json()["group"]["name"] == "Nuevo"
        added = client.post(f"/api/groups/{gid}/members", json={"user_ids": [idc]}, headers=_h(ta))
        assert {m["id"] for m in added.get_json()["group"]["members"]} >= {idc}
        assert client.delete(f"/api/groups/{gid}/members/{idc}", headers=_h(tb)).status_code == 403
        removed = client.delete(f"/api/groups/{gid}/members/{idc}", headers=_h(ta))
        assert idc not in {m["id"] for m in removed.get_json()["group"]["members"]}
        assert client.get(f"/api/groups/{gid}", headers=_h(tc)).status_code == 404

    def test_adding_someone_already_in_is_a_400_and_admins_cannot_be_removed(self, client):
        (ta, ida), (tb, idb) = _users(client, "ada", "bob")
        gid = _group(client, ta, "G", [idb])["id"]
        assert client.post(f"/api/groups/{gid}/members", json={"user_ids": [idb]}, headers=_h(ta)).status_code == 400

        client.patch(f"/api/groups/{gid}/members/{idb}", json={"role": "admin"}, headers=_h(ta))
        assert client.delete(f"/api/groups/{gid}/members/{idb}", headers=_h(ta)).status_code == 404

    def test_promote_lets_a_member_manage(self, client):
        (ta, _), (tb, idb) = _users(client, "ada", "bob")
        gid = _group(client, ta, "G", [idb])["id"]
        promoted = client.patch(f"/api/groups/{gid}/members/{idb}", json={"role": "admin"}, headers=_h(ta))
        assert promoted.status_code == 200
        assert client.patch(f"/api/groups/{gid}", json={"name": "De Bob"}, headers=_h(tb)).status_code == 200
        assert client.patch(f"/api/groups/{gid}/members/{idb}", json={"role": "owner"}, headers=_h(ta)).status_code == 400

    def test_last_admin_leaving_promotes_someone_else(self, client):
        (ta, _), (tb, idb), (tc, idc) = _users(client, "ada", "bob", "cyn")
        gid = _group(client, ta, "G", [idb, idc])["id"]

        assert client.post(f"/api/groups/{gid}/leave", headers=_h(ta)).status_code == 200
        group = client.get(f"/api/groups/{gid}", headers=_h(tb)).get_json()["group"]
        assert len(group["members"]) == 2
        # Los dos entraron a la vez: cuál hereda es indiferente, pero NO puede quedar sin administrador.
        assert [m["role"] for m in group["members"]].count("admin") == 1

    def test_last_person_leaving_deletes_the_group_and_its_messages(self, client):
        (ta, _), (tb, idb) = _users(client, "ada", "bob")
        gid = _group(client, ta, "G", [idb])["id"]
        _say(client, ta, gid, "hola")
        client.post(f"/api/groups/{gid}/leave", headers=_h(tb))
        client.post(f"/api/groups/{gid}/leave", headers=_h(ta))

        from app.extensions import db
        from sqlalchemy import text

        with client.application.app_context():
            assert db.session.execute(text("SELECT count(*) FROM group_chats")).scalar() == 0
            assert db.session.execute(text("SELECT count(*) FROM messages")).scalar() == 0


def _users_id(client, token):
    return client.get("/api/users/me", headers=_h(token)).get_json()["user"]["id"]


class TestMessages:
    def test_everyone_sees_everything_with_the_sender(self, client):
        (ta, ida), (tb, idb), (tc, idc) = _users(client, "ada", "bob", "cyn")
        gid = _group(client, ta, "G", [idb, idc])["id"]

        sent = _say(client, ta, gid, "hola a todos")
        assert sent.status_code == 201
        message = sent.get_json()["message"]
        assert message["group_id"] == gid
        assert message["recipient_id"] is None
        assert message["sender"]["id"] == ida

        for token in (tb, tc):
            body = _thread(client, token, gid).get_json()
            assert [m["content"] for m in body["messages"]] == ["hola a todos"]
            assert body["messages"][0]["sender"]["id"] == ida

    def test_group_messages_do_not_leak_into_direct_conversations(self, client):
        (ta, ida), (tb, idb) = _users(client, "ada", "bob")
        gid = _group(client, ta, "G", [idb])["id"]
        _say(client, ta, gid, "solo en el grupo")

        assert client.get("/api/conversations", headers=_h(ta)).get_json()["conversations"] == []
        assert client.get("/api/conversations", headers=_h(tb)).get_json()["conversations"] == []
        assert client.get(f"/api/users/{ida}/messages", headers=_h(tb)).get_json()["messages"] == []

    def test_unread_is_per_member_and_opening_clears_it(self, client):
        (ta, _), (tb, idb), (tc, idc) = _users(client, "ada", "bob", "cyn")
        gid = _group(client, ta, "G", [idb, idc])["id"]
        _say(client, ta, gid, "uno")

        def unread(token):
            rows = client.get("/api/groups", headers=_h(token)).get_json()["groups"]
            return rows[0]["unread_count"]

        assert (unread(ta), unread(tb), unread(tc)) == (0, 1, 1)  # lo propio no cuenta

        first = _thread(client, tb, gid).get_json()["messages"]
        assert [m["read"] for m in first] == [False]  # estado previo a abrir
        assert unread(tb) == 0
        assert [m["read"] for m in _thread(client, tb, gid).get_json()["messages"]] == [True]

        _say(client, tb, gid, "dos")
        assert (unread(ta), unread(tb), unread(tc)) == (1, 0, 2)

    def test_summary_shows_the_last_message_and_orders_by_activity(self, client):
        (ta, _), (tb, idb) = _users(client, "ada", "bob")
        old = _group(client, ta, "Viejo", [idb])["id"]
        new = _group(client, ta, "Nuevo", [idb])["id"]
        _say(client, ta, old, "el más reciente")

        rows = client.get("/api/groups", headers=_h(ta)).get_json()["groups"]
        assert [r["name"] for r in rows] == ["Viejo", "Nuevo"]
        assert rows[0]["last_message"]["content"] == "el más reciente"
        assert rows[0]["last_message"]["sender_name"] == "Ada"
        assert rows[0]["member_count"] == 2
        assert rows[1]["last_message"] is None
        assert new

    def test_client_id_makes_sending_idempotent(self, client):
        (ta, _), (tb, idb) = _users(client, "ada", "bob")
        gid = _group(client, ta, "G", [idb])["id"]
        first = _say(client, ta, gid, "una vez", client_id="abc-123")
        second = _say(client, ta, gid, "una vez", client_id="abc-123")
        assert (first.status_code, second.status_code) == (201, 200)
        assert first.get_json()["message"]["id"] == second.get_json()["message"]["id"]
        assert len(_thread(client, ta, gid).get_json()["messages"]) == 1

    def test_blocked_senders_are_hidden_either_way_and_reappear(self, client):
        (ta, ida), (tb, idb), (tc, idc) = _users(client, "ada", "bob", "cyn")
        gid = _group(client, ta, "G", [idb, idc])["id"]
        _say(client, tb, gid, "de bob")
        _say(client, tc, gid, "de cy")

        client.post("/api/users/me/blocks", json={"user_id": idb}, headers=_h(ta))
        assert [m["content"] for m in _thread(client, ta, gid).get_json()["messages"]] == ["de cy"]
        # bob (bloqueado) tampoco ve lo de ada, y ve lo de cy
        _say(client, ta, gid, "de ada")
        assert [m["content"] for m in _thread(client, tb, gid).get_json()["messages"]] == ["de bob", "de cy"]

        client.delete(f"/api/users/me/blocks/{idb}", headers=_h(ta))
        assert len(_thread(client, ta, gid).get_json()["messages"]) == 3

    def test_pagination_matches_direct_threads(self, client):
        (ta, _), (tb, idb) = _users(client, "ada", "bob")
        gid = _group(client, ta, "G", [idb])["id"]
        for i in range(5):
            _say(client, ta, gid, f"m{i}")
        page = client.get(f"/api/groups/{gid}/messages?limit=2", headers=_h(ta)).get_json()
        assert [m["content"] for m in page["messages"]] == ["m3", "m4"]
        assert page["has_more"] is True

    def test_empty_text_needs_something_else(self, client):
        (ta, _), (tb, idb) = _users(client, "ada", "bob")
        gid = _group(client, ta, "G", [idb])["id"]
        assert _say(client, ta, gid, "   ").status_code == 400

    def test_authors_edit_and_delete_their_own_group_messages_only(self, client):
        (ta, _), (tb, idb) = _users(client, "ada", "bob")
        gid = _group(client, ta, "G", [idb])["id"]
        mid = _say(client, ta, gid, "original").get_json()["message"]["id"]

        assert client.patch(f"/api/messages/{mid}", json={"content": "x"}, headers=_h(tb)).status_code == 404
        edited = client.patch(f"/api/messages/{mid}", json={"content": "corregido"}, headers=_h(ta))
        assert edited.get_json()["message"]["edited"] is True
        assert edited.get_json()["message"]["group_id"] == gid
        assert client.delete(f"/api/messages/{mid}", headers=_h(tb)).status_code == 404
        assert client.delete(f"/api/messages/{mid}", headers=_h(ta)).status_code == 200


class TestSharedContent:
    def test_a_member_can_share_a_post_they_can_see(self, client):
        (ta, _), (tb, idb) = _users(client, "ada", "bob")
        gid = _group(client, ta, "G", [idb])["id"]
        post_id = client.post("/api/posts", json={"content": "mira esto"}, headers=_h(tb)).get_json()["post"]["id"]

        sent = _say(client, ta, gid, "", post_id=post_id)
        assert sent.status_code == 201
        assert sent.get_json()["message"]["post"]["available"] is True

    def test_post_the_sender_cannot_see_is_rejected(self, client):
        (ta, _), (tb, idb) = _users(client, "ada", "bob")
        client.patch("/api/users/me/privacy", json={"is_private": True}, headers=_h(tb))
        gid = _group(client, ta, "G", [idb])["id"]
        post_id = client.post("/api/posts", json={"content": "privado"}, headers=_h(tb)).get_json()["post"]["id"]
        assert _say(client, ta, gid, "", post_id=post_id).status_code == 404


class TestReportsAndExport:
    def test_any_member_but_the_author_can_report_a_group_message(self, client):
        (ta, _), (tb, idb), (tz, _) = _users(client, "ada", "bob", "zed")
        gid = _group(client, ta, "G", [idb])["id"]
        mid = _say(client, ta, gid, "algo feo").get_json()["message"]["id"]

        def report(token):
            return client.post(
                "/api/reports",
                json={"target_type": "message", "target_id": mid, "reason": "harassment"},
                headers=_h(token),
            )

        assert report(tz).status_code == 404  # no es miembro
        assert report(ta).status_code == 404  # es la autora
        assert report(tb).status_code in (200, 201)

    def test_data_export_includes_own_group_messages_with_the_group_name(self, client):
        (ta, _), (tb, idb) = _users(client, "ada", "bob")
        gid = _group(client, ta, "Mi grupo", [idb])["id"]
        _say(client, ta, gid, "para exportar")

        from app.infrastructure.persistence.repositories.data_export_repository import (
            SQLAlchemyDataExportRepository,
        )

        with client.application.app_context():
            user_id = _users_id(client, ta)
            data = SQLAlchemyDataExportRepository().collect_user_data(__import__("uuid").UUID(user_id))
        mine = [m for m in data["messages"] if m["content"] == "para exportar"]
        assert mine and mine[0]["group_name"] == "Mi grupo" and mine[0]["with_username"] is None


class TestAccountDeletion:
    def _delete(self, client, user_id):
        import uuid

        from app.infrastructure.persistence.repositories.account_deletion_repository import (
            SQLAlchemyAccountDeleter,
        )
        from app.infrastructure.persistence.repositories.rate_limit_repository import (
            SQLAlchemyRateLimitRepository,
        )

        with client.application.app_context():
            return SQLAlchemyAccountDeleter(SQLAlchemyRateLimitRepository()).delete_account(
                uuid.UUID(user_id)
            )

    def test_deleting_the_only_admin_promotes_someone_else_and_keeps_the_group(self, client):
        (ta, ida), (tb, idb), (tc, idc) = _users(client, "ada", "bob", "cyn")
        gid = _group(client, ta, "G", [idb, idc])["id"]
        _say(client, ta, gid, "se va con la cuenta")
        self._delete(client, ida)

        group = client.get(f"/api/groups/{gid}", headers=_h(tb)).get_json()["group"]
        assert [m["role"] for m in group["members"]].count("admin") == 1
        assert {m["id"] for m in group["members"]} == {idb, idc}
        assert _thread(client, tb, gid).get_json()["messages"] == []

    def test_group_where_the_deleted_account_was_alone_disappears(self, client):
        (ta, ida), (tb, idb) = _users(client, "ada", "bob")
        gid = _group(client, ta, "G", [idb])["id"]
        client.post(f"/api/groups/{gid}/leave", headers=_h(tb))
        self._delete(client, ida)

        from app.extensions import db
        from sqlalchemy import text

        with client.application.app_context():
            assert db.session.execute(text("SELECT count(*) FROM group_chats")).scalar() == 0
