# Pruebas de integración de las llamadas 1 a 1 (LiveKit) contra PostgreSQL real. LiveKit no se llama: la
# API solo firma un token con PyJWT, así que se comprueba el token decodificándolo con el secreto de prueba.

import jwt
import pytest

from app.extensions import db
from app.infrastructure.persistence.models import Call
from tests.test_messages import _auth_headers, _register_and_login

SECRET = "test-livekit-secret-0123456789-abcdef"
KEY = "APItestkey"


@pytest.fixture(autouse=True)
def _calls_on(app):
    app.config.update(
        CALLS_ENABLED=True,
        LIVEKIT_URL="wss://thers-test.livekit.cloud",
        LIVEKIT_API_KEY=KEY,
        LIVEKIT_API_SECRET=SECRET,
        CALL_RING_SECONDS=30,
    )


def _two(client):
    ta, ia = _register_and_login(client, username="user_a", email="a@example.com")
    tb, ib = _register_and_login(client, username="user_b", email="b@example.com")
    return (ta, ia), (tb, ib)


def _call(client, token, user_id, kind="audio"):
    return client.post(
        "/api/calls", json={"user_id": user_id, "kind": kind}, headers=_auth_headers(token)
    )


def _post(client, token, path):
    return client.post(path, headers=_auth_headers(token))


class TestDisabled:
    def test_off_by_default_returns_503(self, client, app):
        app.config["CALLS_ENABLED"] = False
        (ta, _), (_, ib) = _two(client)
        response = _call(client, ta, ib)
        assert response.status_code == 503
        assert response.get_json()["code"] == "calls_disabled"

    def test_missing_livekit_secret_returns_503(self, client, app):
        app.config["LIVEKIT_API_SECRET"] = None
        (ta, _), (_, ib) = _two(client)
        assert _call(client, ta, ib).status_code == 503

    def test_incoming_does_not_fail_when_off(self, client, app):
        app.config["CALLS_ENABLED"] = False
        (ta, _), _ = _two(client)
        response = client.get("/api/calls/incoming", headers=_auth_headers(ta))
        assert response.status_code == 200
        assert response.get_json() == {"call": None}


class TestAuth:
    def test_requires_token(self, client):
        assert client.post("/api/calls", json={}).status_code == 401
        assert client.get("/api/calls/incoming").status_code == 401


class TestStart:
    def test_creates_ringing_call_with_scoped_token(self, client):
        (ta, ia), (_, ib) = _two(client)
        response = _call(client, ta, ib, "video")
        assert response.status_code == 201
        body = response.get_json()
        assert body["call"]["status"] == "ringing"
        assert body["call"]["kind"] == "video"
        assert body["call"]["direction"] == "outgoing"
        assert body["access"]["url"] == "wss://thers-test.livekit.cloud"

        claims = jwt.decode(
            body["access"]["token"], SECRET, algorithms=["HS256"], options={"verify_aud": False}
        )
        assert claims["iss"] == KEY
        assert claims["sub"] == ia
        assert claims["video"]["room"] == body["access"]["room"]
        assert claims["video"]["roomJoin"] is True
        # El secreto de LiveKit nunca viaja al cliente.
        assert SECRET not in response.get_data(as_text=True)

    def test_rejects_bad_body(self, client):
        (ta, _), (_, ib) = _two(client)
        assert _call(client, ta, ib, "hologram").status_code == 400
        response = client.post("/api/calls", json={"kind": "audio"}, headers=_auth_headers(ta))
        assert response.status_code == 400

    def test_cannot_call_self(self, client):
        (ta, ia), _ = _two(client)
        assert _call(client, ta, ia).status_code == 400

    def test_unknown_user_is_404(self, client):
        (ta, _), _ = _two(client)
        assert _call(client, ta, "00000000-0000-0000-0000-000000000000").status_code == 404

    def test_respects_who_can_message(self, client):
        (ta, _), (tb, ib) = _two(client)
        client.patch(
            "/api/users/me/privacy", json={"who_can_message": "nobody"}, headers=_auth_headers(tb)
        )
        assert _call(client, ta, ib).status_code == 403

    def test_blocked_caller_sees_not_found(self, client):
        (ta, ia), (tb, ib) = _two(client)
        client.post("/api/users/me/blocks", json={"user_id": ia}, headers=_auth_headers(tb))
        assert _call(client, ta, ib).status_code == 404

    def test_second_call_while_ringing_is_busy(self, client):
        (ta, _), (tb, ib) = _two(client)
        tc, ic = _register_and_login(client, username="user_c", email="c@example.com")
        assert _call(client, ta, ib).status_code == 201
        # La persona llamada ya tiene una llamada sonando; quien llama ya está en una.
        busy = _call(client, tc, ib)
        assert busy.status_code == 409 and busy.get_json()["code"] == "busy"
        assert _call(client, ta, ic).status_code == 409


class TestRingAndAnswer:
    def test_callee_sees_incoming_and_accepts(self, client):
        (ta, ia), (tb, ib) = _two(client)
        call_id = _call(client, ta, ib).get_json()["call"]["id"]

        incoming = client.get("/api/calls/incoming", headers=_auth_headers(tb)).get_json()["call"]
        assert incoming["id"] == call_id
        assert incoming["direction"] == "incoming"
        assert incoming["caller"]["id"] == ia
        # Quien llama no se ve a sí mismo como llamada entrante.
        assert client.get("/api/calls/incoming", headers=_auth_headers(ta)).get_json() == {
            "call": None
        }

        accepted = _post(client, tb, f"/api/calls/{call_id}/accept")
        assert accepted.status_code == 200
        body = accepted.get_json()
        assert body["call"]["status"] == "active"
        claims = jwt.decode(
            body["access"]["token"], SECRET, algorithms=["HS256"], options={"verify_aud": False}
        )
        assert claims["sub"] == ib
        assert claims["video"]["room"] == body["access"]["room"]

        # Quien llamó ve el cambio al consultar.
        seen = client.get(f"/api/calls/{call_id}", headers=_auth_headers(ta)).get_json()["call"]
        assert seen["status"] == "active"

    def test_only_callee_can_accept_or_decline(self, client):
        (ta, _), (_, ib) = _two(client)
        call_id = _call(client, ta, ib).get_json()["call"]["id"]
        assert _post(client, ta, f"/api/calls/{call_id}/accept").status_code == 409
        assert _post(client, ta, f"/api/calls/{call_id}/decline").status_code == 409

    def test_third_person_gets_404(self, client):
        (ta, _), (_, ib) = _two(client)
        tc, _ = _register_and_login(client, username="user_c", email="c@example.com")
        call_id = _call(client, ta, ib).get_json()["call"]["id"]
        assert client.get(f"/api/calls/{call_id}", headers=_auth_headers(tc)).status_code == 404
        assert _post(client, tc, f"/api/calls/{call_id}/accept").status_code == 404
        assert _post(client, tc, f"/api/calls/{call_id}/end").status_code == 404

    def test_decline_frees_both_people(self, client):
        (ta, _), (tb, ib) = _two(client)
        call_id = _call(client, ta, ib).get_json()["call"]["id"]
        declined = _post(client, tb, f"/api/calls/{call_id}/decline")
        assert declined.get_json()["call"]["status"] == "declined"
        assert _post(client, tb, f"/api/calls/{call_id}/accept").status_code == 409
        assert _call(client, ta, ib).status_code == 201

    def test_caller_cancels(self, client):
        (ta, _), (tb, ib) = _two(client)
        call_id = _call(client, ta, ib).get_json()["call"]["id"]
        assert _post(client, ta, f"/api/calls/{call_id}/cancel").get_json()["call"]["status"] == "cancelled"
        assert client.get("/api/calls/incoming", headers=_auth_headers(tb)).get_json() == {"call": None}

    def test_end_is_idempotent_and_either_side_can_hang_up(self, client):
        (ta, _), (tb, ib) = _two(client)
        call_id = _call(client, ta, ib).get_json()["call"]["id"]
        _post(client, tb, f"/api/calls/{call_id}/accept")
        assert _post(client, tb, f"/api/calls/{call_id}/end").get_json()["call"]["status"] == "ended"
        assert _post(client, ta, f"/api/calls/{call_id}/end").get_json()["call"]["status"] == "ended"

    def test_unanswered_call_becomes_missed(self, client, app):
        (ta, _), (tb, ib) = _two(client)
        app.config["CALL_RING_SECONDS"] = 1
        call_id = _call(client, ta, ib).get_json()["call"]["id"]
        with app.app_context():
            db.session.execute(
                db.text("UPDATE calls SET created_at = now() - interval '10 seconds' WHERE id = :i"),
                {"i": call_id},
            )
            db.session.commit()
        assert client.get("/api/calls/incoming", headers=_auth_headers(tb)).get_json() == {"call": None}
        seen = client.get(f"/api/calls/{call_id}", headers=_auth_headers(ta)).get_json()["call"]
        assert seen["status"] == "missed"
        assert _post(client, tb, f"/api/calls/{call_id}/accept").status_code == 409
        with app.app_context():
            assert db.session.get(Call, call_id).status == "missed"
