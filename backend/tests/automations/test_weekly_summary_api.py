# Resumen semanal por n8n (ADR-041 §7): la API interna firmada y la preferencia de la cuenta. Se prueba
# que el BACKEND decide quién recibe qué: solo quien lo activó, con el correo verificado, sin
# suspender y con actividad; con conteos de la semana ya terminada (nunca contenido ni nombres
# ajenos); que sin firma válida no se obtiene nada; y que el acuse es idempotente.

import json
import time
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from app.domain.automations import events, signing
from app.extensions import db
from tests.test_reports import _comment, _h, _post, _register_and_login

SECRET = "secreto-de-prueba-del-resumen"
NEXT = "/api/internal/automations/weekly-summaries/next"
ACK = "/api/internal/automations/weekly-summaries/ack"


@pytest.fixture()
def enabled(app):
    app.config.update(TERO_AUTOMATIONS_ENABLED=True, N8N_WEBHOOK_SECRET=SECRET)


def _signed(client, path, body=None, secret=SECRET, timestamp=None, tamper=False):
    raw = json.dumps(body if body is not None else {}).encode("utf-8")
    stamp = int(time.time()) if timestamp is None else timestamp
    signature = signing.sign(secret, stamp, raw)
    if tamper:
        raw = raw + b" "
    return client.post(
        path, data=raw, content_type="application/json",
        headers={signing.TIMESTAMP_HEADER: str(stamp), signing.SIGNATURE_HEADER: signature},
    )


def _period():
    return events.summary_period(datetime.now(timezone.utc))


def _sql(app, sql, **params):
    with app.app_context():
        db.session.execute(text(sql), params)
        db.session.commit()


def _opt_in(app, user_id):
    _sql(app, "UPDATE users SET weekly_summary_email = true WHERE id = :u", u=user_id)


def _last_week(app, table, column, owner_filter, **params):
    """Lleva la actividad recién creada a mitad de la semana ya terminada."""
    moment = _period()[0] + timedelta(days=2)
    _sql(app, f"UPDATE {table} SET created_at = :t WHERE {owner_filter}", t=moment, **params)


def _activity(app, client, owner_token, owner_id, others):
    """`others` = [(token, id), ...]: la primera sigue, da me gusta y comenta."""
    post_id = _post(client, owner_token, "una publicación")
    follower_token, follower_id = others[0]
    assert client.post(f"/api/users/{owner_id}/follow", headers=_h(follower_token)).status_code in (200, 201)
    assert client.post(f"/api/posts/{post_id}/like", headers=_h(follower_token)).status_code in (200, 201)
    assert _comment(client, follower_token, post_id) is not None
    _last_week(app, "follows", "created_at", "followed_id = :o", o=owner_id)
    _last_week(app, "likes", "created_at", "post_id = :p", p=post_id)
    _last_week(app, "comments", "created_at", "post_id = :p", p=post_id)
    return post_id


@pytest.fixture()
def people(app, client):
    ana = _register_and_login(client, "ana")
    beto = _register_and_login(client, "beto")
    carla = _register_and_login(client, "carla")
    return {"ana": ana, "beto": beto, "carla": carla}


# --- Autenticación ------------------------------------------------------------------------------


def test_the_internal_api_does_not_exist_unless_the_automations_are_on(app, client):
    for path in (NEXT, ACK):
        response = _signed(client, path)
        assert response.status_code == 404
        assert response.get_json() == {"msg": "Recurso no encontrado"}


def test_without_a_configured_secret_it_is_a_404_even_when_switched_on(app, client):
    app.config.update(TERO_AUTOMATIONS_ENABLED=True, N8N_WEBHOOK_SECRET=None)
    assert _signed(client, NEXT).status_code == 404


def test_without_a_valid_signature_nothing_is_returned(app, client, enabled):
    stale = int(time.time()) - signing.MAX_CLOCK_SKEW_SECONDS - 10
    attempts = [
        client.post(NEXT, json={}),                                       # sin firma
        _signed(client, NEXT, secret="otro-secreto"),                     # secreto equivocado
        _signed(client, NEXT, timestamp=stale),                           # firma vieja (repetición)
        _signed(client, NEXT, tamper=True),                               # cuerpo alterado
    ]
    for response in attempts:
        assert response.status_code == 401
        # Mismo mensaje fijo: no se dice cuál de las comprobaciones falló.
        assert response.get_json() == {"msg": "Firma inválida"}


def test_a_jwt_is_not_a_substitute_for_the_signature(app, client, enabled, people):
    token, _ = people["ana"]
    assert client.post(NEXT, json={}, headers=_h(token)).status_code == 401


# --- A quién se le envía --------------------------------------------------------------------------


def test_only_people_who_opted_in_are_included(app, client, enabled, people):
    ana, beto, carla = people["ana"], people["beto"], people["carla"]
    _activity(app, client, ana[0], ana[1], [carla])
    _activity(app, client, beto[0], beto[1], [carla])
    _opt_in(app, ana[1])

    items = _signed(client, NEXT).get_json()["items"]
    assert [item["user_id"] for item in items] == [ana[1]]


def test_the_metrics_are_counts_of_the_finished_week(app, client, enabled, people):
    ana, carla = people["ana"], people["carla"]
    _activity(app, client, ana[0], ana[1], [carla])
    _opt_in(app, ana[1])

    [item] = _signed(client, NEXT).get_json()["items"]
    assert item["metrics"] == {
        "new_followers": 1, "likes_received": 1, "comments_received": 1,
        # Un aviso por cada seguimiento, me gusta y comentario recibidos, aún sin leer.
        "unread_notifications": 3,
    }


def test_the_batch_has_only_what_an_email_needs(app, client, enabled, people):
    ana, carla = people["ana"], people["carla"]
    _activity(app, client, ana[0], ana[1], [carla])
    _opt_in(app, ana[1])

    response = _signed(client, NEXT)
    body = response.get_json()
    start, end = _period()
    assert body["period"] == {
        "from": start.date().isoformat(), "to": (end - timedelta(days=1)).date().isoformat(),
    }
    [item] = body["items"]
    assert set(item) == {
        "user_id", "recipient_email", "first_name", "language", "metrics", "idempotency_key",
    }
    assert item["recipient_email"] == "ana@example.com"
    assert item["first_name"] == "Ana"
    assert item["idempotency_key"] == events.weekly_summary_key(ana[1], end)
    # Nada de quién siguió, quién dio me gusta ni qué se comentó.
    for forbidden in ("carla", "una publicación", "comentario reportable"):
        assert forbidden not in json.dumps(body)
    assert response.headers["Cache-Control"] == "no-store"


def test_only_the_first_name_is_sent(app, client, enabled, people):
    ana, carla = people["ana"], people["carla"]
    _activity(app, client, ana[0], ana[1], [carla])
    _opt_in(app, ana[1])
    _sql(app, "UPDATE users SET name = 'Ana María López Pérez' WHERE id = :u", u=ana[1])
    assert _signed(client, NEXT).get_json()["items"][0]["first_name"] == "Ana"


def test_someone_with_no_activity_gets_no_summary(app, client, enabled, people):
    _opt_in(app, people["ana"][1])
    assert _signed(client, NEXT).get_json()["items"] == []


def test_activity_outside_the_finished_week_does_not_count(app, client, enabled, people):
    ana, carla = people["ana"], people["carla"]
    _activity(app, client, ana[0], ana[1], [carla])
    _sql(app, "UPDATE likes SET created_at = :t", t=_period()[0] - timedelta(days=1))
    _sql(app, "UPDATE comments SET created_at = :t", t=_period()[1])
    _opt_in(app, ana[1])
    [item] = _signed(client, NEXT).get_json()["items"]
    assert item["metrics"]["likes_received"] == 0
    assert item["metrics"]["comments_received"] == 0
    assert item["metrics"]["new_followers"] == 1


def test_unverified_and_suspended_accounts_are_skipped(app, client, enabled, people):
    ana, beto, carla = people["ana"], people["beto"], people["carla"]
    for owner in (ana, beto):
        _activity(app, client, owner[0], owner[1], [carla])
        _opt_in(app, owner[1])
    _sql(app, "UPDATE users SET email_verified = false WHERE id = :u", u=ana[1])
    _sql(app, "UPDATE users SET suspended_at = now() WHERE id = :u", u=beto[1])
    assert _signed(client, NEXT).get_json()["items"] == []


def test_invalid_batch_requests_are_a_400(app, client, enabled):
    for body in ({"limit": 0}, {"limit": 101}, {"limit": "5"}, {"limit": True}, {"after": "no-es-uuid"}):
        assert _signed(client, NEXT, body).status_code == 400


def test_pagination_with_a_cursor_never_repeats_or_skips_anyone(app, client, enabled, people):
    carla = people["carla"]
    ana, beto = people["ana"], people["beto"]
    dani = _register_and_login(client, "dani")
    owners = [ana, beto, dani]
    for owner in owners:
        _activity(app, client, owner[0], owner[1], [carla])
        _opt_in(app, owner[1])

    first = _signed(client, NEXT, {"limit": 2}).get_json()
    assert len(first["items"]) == 2 and first["next_after"] is not None
    second = _signed(client, NEXT, {"limit": 2, "after": first["next_after"]}).get_json()
    assert len(second["items"]) == 1 and second["next_after"] is None

    seen = [item["user_id"] for item in first["items"] + second["items"]]
    assert sorted(seen) == sorted(owner[1] for owner in owners)


# --- Acuse --------------------------------------------------------------------------------------


def _ack(client, user_id, status="sent", key=None, period_end=None):
    end = period_end or _period()[1]
    return _signed(client, ACK, {"items": [{
        "user_id": user_id, "status": status,
        "idempotency_key": key or events.weekly_summary_key(user_id, end),
    }]})


def _one_pending(app, client, people):
    ana, carla = people["ana"], people["carla"]
    _activity(app, client, ana[0], ana[1], [carla])
    _opt_in(app, ana[1])
    return ana[1]


def test_an_acknowledged_summary_is_not_offered_again(app, client, enabled, people):
    user_id = _one_pending(app, client, people)
    assert _ack(client, user_id).get_json() == {"recorded": 1, "ignored": 0}
    assert _signed(client, NEXT).get_json()["items"] == []


def test_acknowledging_twice_is_harmless(app, client, enabled, people):
    user_id = _one_pending(app, client, people)
    assert _ack(client, user_id).get_json()["recorded"] == 1
    assert _ack(client, user_id).get_json() == {"recorded": 0, "ignored": 1}


def test_a_failed_delivery_is_not_recorded_so_it_is_retried_next_run(app, client, enabled, people):
    user_id = _one_pending(app, client, people)
    assert _ack(client, user_id, status="failed").get_json() == {"recorded": 0, "ignored": 1}
    assert [i["user_id"] for i in _signed(client, NEXT).get_json()["items"]] == [user_id]


def test_a_key_from_another_week_or_invented_is_ignored(app, client, enabled, people):
    user_id = _one_pending(app, client, people)
    old_end = _period()[1] - timedelta(days=7)
    assert _ack(client, user_id, period_end=old_end).get_json() == {"recorded": 0, "ignored": 1}
    assert _ack(client, user_id, key="inventada").get_json() == {"recorded": 0, "ignored": 1}
    assert len(_signed(client, NEXT).get_json()["items"]) == 1


def test_someone_who_never_opted_in_cannot_be_marked(app, client, enabled, people):
    ana = people["ana"]
    assert _ack(client, ana[1]).get_json() == {"recorded": 0, "ignored": 1}


def test_a_summary_sent_before_this_period_is_offered_again(app, client, enabled, people):
    user_id = _one_pending(app, client, people)
    _sql(app, "UPDATE users SET weekly_summary_sent_at = :t WHERE id = :u",
         t=_period()[0], u=user_id)
    assert len(_signed(client, NEXT).get_json()["items"]) == 1


def test_malformed_acknowledgements_are_a_400_or_ignored(app, client, enabled, people):
    for body in ({}, {"items": []}, {"items": "x"}, {"items": [{}] * 101}):
        assert _signed(client, ACK, body).status_code == 400
    response = _signed(client, ACK, {"items": ["no-es-objeto", {"user_id": "xx"}]})
    assert response.status_code == 200
    assert response.get_json() == {"recorded": 0, "ignored": 2}


# --- Preferencia de la cuenta ---------------------------------------------------------------------


def test_the_weekly_summary_is_off_by_default_and_can_be_switched_on_and_off(app, client, people):
    token, _ = people["ana"]
    assert client.get("/api/users/me/privacy", headers=_h(token)).get_json()["privacy"]["weekly_summary_email"] is False

    on = client.patch("/api/users/me/privacy", json={"weekly_summary_email": True}, headers=_h(token))
    assert on.status_code == 200 and on.get_json()["privacy"]["weekly_summary_email"] is True
    off = client.patch("/api/users/me/privacy", json={"weekly_summary_email": False}, headers=_h(token))
    assert off.get_json()["privacy"]["weekly_summary_email"] is False


def test_the_preference_must_be_a_real_boolean(app, client, people):
    token, _ = people["ana"]
    for value in ("true", 1, None, "false"):
        response = client.patch("/api/users/me/privacy", json={"weekly_summary_email": value}, headers=_h(token))
        assert response.status_code == 400


def test_nobody_can_change_someone_elses_preference_nor_the_sent_mark(app, client, people):
    token, user_id = people["ana"]
    response = client.patch(
        "/api/users/me/privacy",
        json={"weekly_summary_email": True, "weekly_summary_sent_at": "2020-01-01T00:00:00Z"},
        headers=_h(token),
    )
    assert response.status_code == 200
    with app.app_context():
        row = db.session.execute(
            text("SELECT weekly_summary_sent_at FROM users WHERE id = :u"), {"u": user_id}
        ).scalar_one()
    assert row is None
