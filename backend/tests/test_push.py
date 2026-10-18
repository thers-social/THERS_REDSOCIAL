# Notificaciones push (ADR-053) contra PostgreSQL real. Firebase se sustituye por un cliente falso que
# apunta lo que se enviaría: NINGUNA prueba sale a la red.

import pytest

from app.application.push import events as push_events
from app.domain.push import payloads
from app.infrastructure.persistence.repositories.group_repository import SQLAlchemyGroupRepository
from app.infrastructure.persistence.repositories.push_device_repository import (
    SQLAlchemyPushDeviceRepository,
)
from app.infrastructure.persistence.repositories.restriction_repository import (
    SQLAlchemyRestrictionRepository,
)
from app.infrastructure.persistence.repositories.user_repository import SQLAlchemyUserRepository
from app.infrastructure.push.fcm_client import FAILED, INVALID_TOKEN, OK
from app.infrastructure.push.notifier import PushNotifier
from tests.test_saved_and_shared_posts import _h, _post, _register_and_login

TOKEN_A = "token-de-ana-" + "a" * 30
TOKEN_B = "token-de-beto-" + "b" * 30
TOKEN_C = "token-de-carla-" + "c" * 30


class FakeFcm:
    def __init__(self):
        self.sent = []
        self.answers = {}

    def send(self, token, title, body, data):
        self.sent.append({"token": token, "title": title, "body": body, "data": data})
        return self.answers.get(token, OK)


@pytest.fixture()
def fcm(app):
    client = FakeFcm()
    notifier = PushNotifier(
        app, client, SQLAlchemyPushDeviceRepository(), SQLAlchemyUserRepository(),
        SQLAlchemyGroupRepository(), SQLAlchemyRestrictionRepository(), sync=True,
    )
    push_events.set_notifier(notifier)
    yield client
    push_events.set_notifier(None)


def _register(client, token, device_token, platform="android"):
    return client.post(
        "/api/push/devices", json={"token": device_token, "platform": platform}, headers=_h(token)
    )


def _people(client):
    return {name: _register_and_login(client, name) for name in ("ana", "beto", "carla")}


class TestDevices:
    def test_register_and_unregister(self, client):
        token, _ = _register_and_login(client, "ana")

        assert _register(client, token, TOKEN_A).get_json() == {"registered": True}
        assert client.delete("/api/push/devices", json={"token": TOKEN_A}, headers=_h(token)).get_json() == {
            "registered": False
        }
        # Idempotente.
        assert client.delete("/api/push/devices", json={"token": TOKEN_A}, headers=_h(token)).status_code == 200

    def test_validation_and_authentication(self, client):
        token, _ = _register_and_login(client, "ana")

        assert _register(client, token, "corto").status_code == 400
        assert _register(client, token, "con espacios " + "x" * 30).status_code == 400
        assert _register(client, token, TOKEN_A, platform="windows").status_code == 400
        assert client.post("/api/push/devices", json={"token": TOKEN_A}).status_code == 401

    def test_a_token_moves_to_the_account_that_logs_in_last(self, client, app, fcm):
        ana, ana_id = _register_and_login(client, "ana")
        beto, beto_id = _register_and_login(client, "beto")
        _register(client, ana, TOKEN_A)
        _register(client, beto, TOKEN_A)  # mismo teléfono, otra cuenta

        repo = SQLAlchemyPushDeviceRepository()
        with app.app_context():
            assert repo.tokens_for_users([ana_id]) == {}
            assert repo.tokens_for_users([beto_id]) == {beto_id: [TOKEN_A]}

    def test_one_cannot_remove_someone_elses_device(self, client, app):
        ana, ana_id = _register_and_login(client, "ana")
        beto, _ = _register_and_login(client, "beto")
        _register(client, ana, TOKEN_A)

        client.delete("/api/push/devices", json={"token": TOKEN_A}, headers=_h(beto))

        with app.app_context():
            assert SQLAlchemyPushDeviceRepository().tokens_for_users([ana_id]) == {ana_id: [TOKEN_A]}


class TestNotifications:
    def test_follow_like_and_comment_reach_the_recipient_only(self, client, fcm):
        people = _people(client)
        ana, ana_id = people["ana"]
        beto, beto_id = people["beto"]
        _register(client, ana, TOKEN_A)
        _register(client, beto, TOKEN_B)

        client.post(f"/api/users/{ana_id}/follow", headers=_h(beto))
        post_id = _post(client, ana, "hola")
        client.post(f"/api/posts/{post_id}/like", headers=_h(beto))
        client.post(f"/api/posts/{post_id}/comments", json={"content": "buenísimo"}, headers=_h(beto))

        bodies = [(m["token"], m["body"]) for m in fcm.sent]
        assert bodies == [
            (TOKEN_A, "@beto empezó a seguirte"),
            (TOKEN_A, "A @beto le gustó tu publicación"),
            (TOKEN_A, "@beto comentó tu publicación"),
        ]
        assert fcm.sent[1]["data"]["post_id"] == post_id and fcm.sent[1]["data"]["type"] == "like"
        assert fcm.sent[0]["data"]["actor_id"] == beto_id

    def test_a_private_account_gets_a_follow_request_text(self, client, fcm):
        people = _people(client)
        ana, ana_id = people["ana"]
        beto, _ = people["beto"]
        client.patch("/api/users/me/privacy", json={"is_private": True}, headers=_h(ana))
        _register(client, ana, TOKEN_A)

        client.post(f"/api/users/{ana_id}/follow", headers=_h(beto))

        assert [m["body"] for m in fcm.sent] == ["@beto quiere seguirte"]

    def test_nothing_is_sent_without_a_registered_device(self, client, fcm):
        people = _people(client)
        client.post(f"/api/users/{people['ana'][1]}/follow", headers=_h(people["beto"][0]))

        assert fcm.sent == []

    def test_a_dead_token_is_removed_and_a_failure_does_not_break_the_action(self, client, app, fcm):
        people = _people(client)
        ana, ana_id = people["ana"]
        _register(client, ana, TOKEN_A)
        fcm.answers[TOKEN_A] = INVALID_TOKEN

        response = client.post(f"/api/users/{ana_id}/follow", headers=_h(people["beto"][0]))

        assert response.status_code == 200
        with app.app_context():
            assert SQLAlchemyPushDeviceRepository().tokens_for_users([ana_id]) == {}

    def test_a_transient_failure_keeps_the_token(self, client, app, fcm):
        people = _people(client)
        ana, ana_id = people["ana"]
        _register(client, ana, TOKEN_A)
        fcm.answers[TOKEN_A] = FAILED

        client.post(f"/api/users/{ana_id}/follow", headers=_h(people["beto"][0]))

        with app.app_context():
            assert SQLAlchemyPushDeviceRepository().tokens_for_users([ana_id]) == {ana_id: [TOKEN_A]}

    def test_without_a_notifier_everything_keeps_working(self, client):
        people = _people(client)
        response = client.post(f"/api/users/{people['ana'][1]}/follow", headers=_h(people["beto"][0]))

        assert response.status_code == 200


class TestMessages:
    def test_a_direct_message_notifies_the_recipient_with_a_preview(self, client, fcm):
        people = _people(client)
        ana, ana_id = people["ana"]
        beto, beto_id = people["beto"]
        _register(client, ana, TOKEN_A)
        _register(client, beto, TOKEN_B)

        client.post(f"/api/users/{beto_id}/messages", json={"content": "¿Vamos por un café?"}, headers=_h(ana))

        [push] = fcm.sent
        assert push["token"] == TOKEN_B
        assert push["title"] == "Ana"
        assert push["body"] == "¿Vamos por un café?"
        assert push["data"] == {"type": "message", "sender_id": ana_id}

    def test_a_retried_send_does_not_notify_twice(self, client, fcm):
        people = _people(client)
        ana, _ = people["ana"]
        beto, beto_id = people["beto"]
        _register(client, beto, TOKEN_B)
        body = {"content": "hola", "client_id": "c1"}

        client.post(f"/api/users/{beto_id}/messages", json=body, headers=_h(ana))
        client.post(f"/api/users/{beto_id}/messages", json=body, headers=_h(ana))

        assert len(fcm.sent) == 1

    def test_a_group_message_notifies_the_other_members_except_blocked_ones(self, client, fcm):
        people = _people(client)
        ana, ana_id = people["ana"]
        beto, beto_id = people["beto"]
        carla, carla_id = people["carla"]
        for token, device in ((ana, TOKEN_A), (beto, TOKEN_B), (carla, TOKEN_C)):
            _register(client, token, device)
        group = client.post(
            "/api/groups", json={"name": "Amigas", "member_ids": [beto_id, carla_id]}, headers=_h(ana)
        ).get_json()["group"]
        client.post("/api/users/me/blocks", json={"user_id": carla_id}, headers=_h(ana))

        client.post(f"/api/groups/{group['id']}/messages", json={"content": "buenas"}, headers=_h(ana))

        [push] = fcm.sent  # carla está bloqueada por ana: no se le avisa
        assert push["token"] == TOKEN_B
        assert push["title"] == "Amigas" and push["body"] == "Ana: buenas"
        assert push["data"] == {"type": "group_message", "group_id": group["id"]}


class TestPayloads:
    def test_preview_prefers_text_and_names_attachments(self):
        assert payloads.message_preview("  hola   mundo ") == "hola mundo"
        assert payloads.message_preview("", has_image=True) == "📷 Foto"
        assert payloads.message_preview("", has_audio=True) == "🎤 Nota de voz"
        assert payloads.message_preview("", has_video=True) == "🎬 Video"
        assert payloads.message_preview("") == "Nuevo mensaje"

    def test_long_text_is_cut(self):
        preview = payloads.message_preview("x" * 300)
        assert len(preview) <= payloads.MAX_BODY and preview.endswith("…")

    def test_unknown_notification_types_are_not_pushed(self):
        assert payloads.notification_payload("algo_raro", "ana") is None
