# Tero, fase 6 (ADR-041 §6.2): acciones con confirmación. Lo que se prueba es la promesa del ADR:
#   · el modelo PROPONE, nunca ejecuta: proponer no cambia ningún dato;
#   · lo que se ejecuta es exactamente lo que muestra la tarjeta (la redacta el servidor);
#   · solo la persona dueña confirma; la identidad sale del JWT, no del cuerpo;
#   · una acción se ejecuta UNA vez (doble confirmación, cancelada, vencida, bloqueada);
#   · apagar las acciones corta también las que ya estaban pendientes.
# NINGUNA prueba llama a la API real: el proveedor es un guion.

import pytest
from sqlalchemy import text

from app.application.tero import tools as tero_tools
from app.domain.rate_limiting import policy
from app.domain.rate_limiting.policy import RateLimitRule
from app.domain.tero import actions as action_rules
from app.extensions import db
from tests.test_reports import _register_and_login
from tests.tero.test_tero_tools import (
    ScriptedProvider,
    _auth,
    _chat,
    _install,
    final,
    tool_turn,
)


@pytest.fixture()
def world(app, client):
    """Tero con IA, herramientas y acciones encendidas, y tres personas con sesión."""
    app.config.update(
        TERO_ENABLED=True, TERO_AI_ENABLED=True, TERO_TOOLS_ENABLED=True, TERO_ACTIONS_ENABLED=True
    )
    return {name: _register_and_login(client, name) for name in ("ana", "beto", "carla")}


def _propose(app, client, token, name, arguments):
    """Chatea con un guion que PROPONE; devuelve (respuesta, proveedor)."""
    provider = _install(app, ScriptedProvider(tool_turn(name, arguments), final("Preparé la acción.")))
    return _chat(client, token), provider


def _cards(response):
    return response.get_json()["confirmation_cards"]


def _confirm(client, token, action_id, **body):
    return client.post(f"/api/tero/actions/{action_id}/confirm", json=body, headers=_auth(token))


def _cancel(client, token, action_id):
    return client.post(f"/api/tero/actions/{action_id}/cancel", headers=_auth(token))


def _count(app, sql, **params):
    with app.app_context():
        return db.session.execute(text(sql), params).scalar_one()


def _follows(app, follower_id, followed_id):
    return _count(
        app,
        "SELECT count(*) FROM follows WHERE follower_id = :a AND followed_id = :b",
        a=follower_id, b=followed_id,
    )


def _status(app, action_id):
    return _count(app, "SELECT status FROM tero_pending_actions WHERE id = :i", i=action_id)


def _me(client, token):
    return client.get("/api/users/me", headers=_auth(token)).get_json()["user"]


# --- Proponer NO ejecuta ------------------------------------------------------------------


def test_proposing_a_follow_returns_a_card_and_changes_nothing(app, client, world):
    ana_token, ana_id = world["ana"]
    beto_id = world["beto"][1]
    response, provider = _propose(app, client, ana_token, "propose_follow_user", {"username": "beto"})

    assert response.status_code == 200
    body = response.get_json()
    assert body["source"] == "ai"
    [card] = body["confirmation_cards"]
    # La tarjeta la redacta el servidor: es exactamente lo que se ejecutará.
    assert card["summary"] == "Seguir a @beto"
    assert card["kind"] == "follow_user"
    assert set(card) == {"id", "kind", "summary", "expires_at"}
    # Nada se hizo: ni follow, ni notificación a beto.
    assert _follows(app, ana_id, beto_id) == 0
    assert _count(app, "SELECT count(*) FROM notifications WHERE recipient_id = :u", u=beto_id) == 0
    # Al modelo se le dice con claridad que NO está hecho.
    result = provider.calls[1]["messages"][-1]["content"][0]["content"]
    assert "NO está hecha" in result
    # La tarjeta va al cliente, no al modelo.
    assert card["id"] not in result


def test_a_private_account_card_says_it_is_only_a_request(app, client, world):
    beto_token, beto_id = world["beto"]
    client.patch("/api/users/me/privacy", json={"is_private": True}, headers=_auth(beto_token))
    response, _ = _propose(app, client, world["ana"][0], "propose_follow_user", {"username": "@Beto"})
    assert _cards(response)[0]["summary"] == "Enviar solicitud de seguimiento a @beto"


def test_proposing_a_profile_change_does_not_touch_the_profile(app, client, world):
    token, _ = world["ana"]
    before = _me(client, token)
    response, _ = _propose(
        app, client, token, "propose_update_profile", {"name": "Ana López", "bio": "Hola, soy Ana"}
    )
    assert _cards(response)[0]["summary"] == (
        'Cambiar tu nombre a "Ana López"; Cambiar tu biografía a "Hola, soy Ana"'
    )
    after = _me(client, token)
    assert (after["name"], after.get("bio")) == (before["name"], before.get("bio"))


def test_the_chat_always_carries_a_list_of_cards(app, client, world):
    provider = _install(app, ScriptedProvider(final("Hola")))
    assert _chat(client, world["ana"][0]).get_json()["confirmation_cards"] == []
    app.config["TERO_AI_ENABLED"] = False
    assert _chat(client, world["ana"][0]).get_json()["confirmation_cards"] == []


# --- Confirmar ejecuta, y una sola vez ------------------------------------------------------


def test_confirming_runs_the_follow_through_the_existing_use_case(app, client, world):
    ana_token, ana_id = world["ana"]
    beto_id = world["beto"][1]
    [card] = _cards(_propose(app, client, ana_token, "propose_follow_user", {"username": "beto"})[0])

    response = _confirm(client, ana_token, card["id"])
    assert response.status_code == 200
    assert response.get_json() == {"status": "confirmed", "result": {"follow_status": "accepted"}}
    assert _follows(app, ana_id, beto_id) == 1
    # Es la misma ruta que la app: beto recibe su aviso de nuevo seguidor.
    assert _count(app, "SELECT count(*) FROM notifications WHERE recipient_id = :u", u=beto_id) == 1
    assert _status(app, card["id"]) == "confirmed"


def test_a_second_confirmation_does_not_run_it_again(app, client, world):
    ana_token, ana_id = world["ana"]
    beto_id = world["beto"][1]
    [card] = _cards(_propose(app, client, ana_token, "propose_follow_user", {"username": "beto"})[0])
    assert _confirm(client, ana_token, card["id"]).status_code == 200

    again = _confirm(client, ana_token, card["id"])
    assert again.status_code == 200
    assert again.get_json() == {"status": "confirmed", "already_confirmed": True}
    assert _follows(app, ana_id, beto_id) == 1
    assert _count(app, "SELECT count(*) FROM notifications WHERE recipient_id = :u", u=beto_id) == 1


def test_confirming_a_profile_change_applies_exactly_what_the_card_showed(app, client, world):
    token, _ = world["ana"]
    [card] = _cards(
        _propose(app, client, token, "propose_update_profile", {"name": "Ana López", "bio": "Hola"})[0]
    )
    response = _confirm(client, token, card["id"])
    assert response.get_json() == {"status": "confirmed", "result": {"updated": ["bio", "name"]}}
    me = _me(client, token)
    assert (me["name"], me["bio"]) == ("Ana López", "Hola")


def test_an_empty_bio_clears_it(app, client, world):
    token, _ = world["ana"]
    first = _cards(_propose(app, client, token, "propose_update_profile", {"bio": "Algo"})[0])[0]
    _confirm(client, token, first["id"])
    [card] = _cards(_propose(app, client, token, "propose_update_profile", {"bio": ""})[0])
    assert card["summary"] == "Borrar tu biografía"
    _confirm(client, token, card["id"])
    assert _me(client, token).get("bio") in (None, "")


def test_unfollow_removes_an_existing_follow(app, client, world):
    ana_token, ana_id = world["ana"]
    beto_id = world["beto"][1]
    assert client.post(f"/api/users/{beto_id}/follow", headers=_auth(ana_token)).status_code in (200, 201)
    [card] = _cards(_propose(app, client, ana_token, "propose_unfollow_user", {"username": "beto"})[0])
    assert card["summary"] == "Dejar de seguir a @beto"
    assert _follows(app, ana_id, beto_id) == 1
    assert _confirm(client, ana_token, card["id"]).status_code == 200
    assert _follows(app, ana_id, beto_id) == 0


# --- Dueño e identidad ---------------------------------------------------------------------


def test_only_the_owner_can_confirm_and_a_stranger_gets_a_plain_404(app, client, world):
    ana_token, ana_id = world["ana"]
    carla_token, carla_id = world["carla"]
    beto_id = world["beto"][1]
    [card] = _cards(_propose(app, client, ana_token, "propose_follow_user", {"username": "beto"})[0])

    # Ni siquiera mandando el id de la dueña en el cuerpo: la identidad es el JWT.
    stranger = _confirm(client, carla_token, card["id"], user_id=ana_id)
    assert stranger.status_code == 404
    assert stranger.get_json() == {"msg": "Acción no encontrada"}
    assert _follows(app, ana_id, beto_id) == 0
    assert _follows(app, carla_id, beto_id) == 0
    # Una acción que no existe da EXACTAMENTE lo mismo: no se puede sondear qué ids existen.
    missing = _confirm(client, carla_token, "00000000-0000-4000-8000-000000000000")
    assert (missing.status_code, missing.get_json()) == (404, stranger.get_json())
    assert _status(app, card["id"]) == "pending"


def test_a_stranger_cannot_cancel_it_either(app, client, world):
    ana_token, _ = world["ana"]
    [card] = _cards(_propose(app, client, ana_token, "propose_follow_user", {"username": "beto"})[0])
    assert _cancel(client, world["carla"][0], card["id"]).status_code == 404
    assert _status(app, card["id"]) == "pending"


def test_confirming_requires_a_session(client):
    response = client.post("/api/tero/actions/00000000-0000-4000-8000-000000000000/confirm")
    assert response.status_code == 401


# --- Cancelar, vencer, fallar --------------------------------------------------------------


def test_a_cancelled_action_can_no_longer_be_confirmed(app, client, world):
    ana_token, ana_id = world["ana"]
    beto_id = world["beto"][1]
    [card] = _cards(_propose(app, client, ana_token, "propose_follow_user", {"username": "beto"})[0])

    assert _cancel(client, ana_token, card["id"]).get_json() == {"status": "cancelled"}
    # Cancelar dos veces no falla.
    assert _cancel(client, ana_token, card["id"]).get_json() == {
        "status": "cancelled", "already_cancelled": True,
    }
    response = _confirm(client, ana_token, card["id"])
    assert response.status_code == 409
    assert response.get_json()["code"] == "action_cancelled"
    assert _follows(app, ana_id, beto_id) == 0


def test_a_confirmed_action_cannot_be_undone_by_cancelling(app, client, world):
    ana_token, _ = world["ana"]
    [card] = _cards(_propose(app, client, ana_token, "propose_follow_user", {"username": "beto"})[0])
    _confirm(client, ana_token, card["id"])
    response = _cancel(client, ana_token, card["id"])
    assert response.status_code == 409
    assert response.get_json()["code"] == "action_confirmed"


def test_an_expired_action_does_not_run(app, client, world):
    ana_token, ana_id = world["ana"]
    beto_id = world["beto"][1]
    [card] = _cards(_propose(app, client, ana_token, "propose_follow_user", {"username": "beto"})[0])
    with app.app_context():
        db.session.execute(
            text("UPDATE tero_pending_actions SET expires_at = now() - interval '1 minute' WHERE id = :i"),
            {"i": card["id"]},
        )
        db.session.commit()

    response = _confirm(client, ana_token, card["id"])
    assert response.status_code == 409
    assert response.get_json()["code"] == "action_expired"
    assert _follows(app, ana_id, beto_id) == 0


def test_the_card_expires_in_minutes_not_hours(app, client, world):
    [card] = _cards(_propose(app, client, world["ana"][0], "propose_follow_user", {"username": "beto"})[0])
    assert action_rules.EXPIRY_MINUTES <= 15
    minutes = _count(
        app,
        "SELECT extract(epoch FROM (expires_at - created_at)) / 60 FROM tero_pending_actions WHERE id = :i",
        i=card["id"],
    )
    assert 0 < float(minutes) <= action_rules.EXPIRY_MINUTES + 0.1


def test_permissions_are_checked_again_at_confirmation_time(app, client, world):
    ana_token, ana_id = world["ana"]
    beto_token, beto_id = world["beto"]
    [card] = _cards(_propose(app, client, ana_token, "propose_follow_user", {"username": "beto"})[0])
    # Entre la propuesta y la confirmación, beto bloquea a ana.
    assert client.post(
        "/api/users/me/blocks", json={"user_id": ana_id}, headers=_auth(beto_token)
    ).status_code == 200

    response = _confirm(client, ana_token, card["id"])
    assert response.status_code == 409
    assert response.get_json() == {"msg": "No se pudo completar la acción.", "code": "action_failed"}
    assert _follows(app, ana_id, beto_id) == 0
    assert _status(app, card["id"]) == "failed"
    # Y no se puede reintentar: una acción fallida no se vuelve a ejecutar.
    assert _confirm(client, ana_token, card["id"]).status_code == 409


# --- Qué se puede proponer ------------------------------------------------------------------


def test_proposals_that_make_no_sense_create_no_card(app, client, world):
    ana_token, _ = world["ana"]
    beto_id = world["beto"][1]
    assert client.post(f"/api/users/{beto_id}/follow", headers=_auth(ana_token)).status_code in (200, 201)

    cases = [
        ("propose_follow_user", {"username": "ana"}),         # uno mismo
        ("propose_follow_user", {"username": "nadie_existe"}),
        ("propose_follow_user", {"username": "beto"}),        # ya lo sigue
        ("propose_unfollow_user", {"username": "carla"}),     # no la sigue
    ]
    for name, arguments in cases:
        response, _ = _propose(app, client, ana_token, name, arguments)
        assert response.status_code == 200
        assert _cards(response) == []
    assert _count(app, "SELECT count(*) FROM tero_pending_actions") == 0


def test_a_blocked_person_looks_exactly_like_a_missing_one(app, client, world):
    ana_token, _ = world["ana"]
    beto_id = world["beto"][1]
    client.post("/api/users/me/blocks", json={"user_id": beto_id}, headers=_auth(ana_token))

    seen = []
    for username in ("beto", "nadie_existe"):
        _, provider = _propose(app, client, ana_token, "propose_follow_user", {"username": username})
        seen.append(provider.calls[1]["messages"][-1]["content"][0]["content"])
    assert seen[0] == seen[1]


def test_only_name_and_bio_can_be_edited_from_tero(app, client, world):
    token, _ = world["ana"]
    for forbidden in ({"username": "otro"}, {"email": "x@y.z"}, {"is_private": True}, {"password": "x"}):
        response, provider = _propose(app, client, token, "propose_update_profile", forbidden)
        assert _cards(response) == []
        assert provider.calls[1]["messages"][-1]["content"][0]["is_error"] is True
    assert _count(app, "SELECT count(*) FROM tero_pending_actions") == 0


def test_a_bio_over_the_limit_is_rejected(app, client, world):
    response, provider = _propose(
        app, client, world["ana"][0], "propose_update_profile", {"bio": "x" * 161}
    )
    assert _cards(response) == []
    assert provider.calls[1]["messages"][-1]["content"][0]["is_error"] is True


def test_no_tool_exists_for_the_dangerous_actions():
    names = set(tero_tools.REGISTRY)
    for forbidden in ("delete_account", "change_password", "change_email", "disable_2fa", "block_user"):
        assert not any(forbidden in name for name in names)
    propose = {name for name, tool in tero_tools.REGISTRY.items() if tool.spec.risk == "propose"}
    assert propose == {"propose_follow_user", "propose_unfollow_user", "propose_update_profile"}
    assert all(name.startswith("propose_") for name in propose)


def test_there_is_a_cap_on_pending_proposals(app, client, world):
    token, _ = world["ana"]
    for index in range(action_rules.MAX_PENDING_PER_USER):
        assert len(_cards(_propose(app, client, token, "propose_update_profile", {"bio": f"b{index}"})[0])) == 1
    response, provider = _propose(app, client, token, "propose_update_profile", {"bio": "una más"})
    assert _cards(response) == []
    assert "demasiadas" in provider.calls[1]["messages"][-1]["content"][0]["content"].lower()


# --- Interruptores y límites ---------------------------------------------------------------


def test_with_actions_off_the_propose_tools_are_not_offered_or_runnable(app, client, world):
    app.config["TERO_ACTIONS_ENABLED"] = False
    provider = _install(
        app, ScriptedProvider(tool_turn("propose_follow_user", {"username": "beto"}), final())
    )
    response = _chat(client, world["ana"][0])
    offered = {item["name"] for item in provider.calls[0]["tools"]}
    assert not any(name.startswith("propose_") for name in offered)
    # Aunque el modelo la pidiera igual, no existe para esta petición.
    assert provider.calls[1]["messages"][-1]["content"][0]["is_error"] is True
    assert _cards(response) == []


def test_with_actions_on_all_eight_tools_are_offered(app, client, world):
    provider = _install(app, ScriptedProvider(final()))
    _chat(client, world["ana"][0])
    assert len(provider.calls[0]["tools"]) == 8


def test_switching_actions_off_also_blocks_confirming_what_was_already_pending(app, client, world):
    ana_token, ana_id = world["ana"]
    beto_id = world["beto"][1]
    [card] = _cards(_propose(app, client, ana_token, "propose_follow_user", {"username": "beto"})[0])
    app.config["TERO_ACTIONS_ENABLED"] = False
    for call in (_confirm(client, ana_token, card["id"]), _cancel(client, ana_token, card["id"])):
        assert call.status_code == 503
        assert call.get_json()["code"] == "tero_actions_disabled"
    assert _follows(app, ana_id, beto_id) == 0


def test_the_whole_module_off_blocks_the_action_endpoints(app, client, world):
    app.config["TERO_ENABLED"] = False
    response = _confirm(client, world["ana"][0], "00000000-0000-4000-8000-000000000000")
    assert response.status_code == 503
    assert response.get_json()["code"] == "tero_disabled"


def test_actions_are_off_unless_explicitly_enabled(app):
    assert app.config["TERO_ACTIONS_ENABLED"] is False


def test_confirmations_have_their_own_per_account_limit(app, client, world, monkeypatch):
    token, _ = world["ana"]
    monkeypatch.setattr(policy, "TERO_ACTION", RateLimitRule("tero_action", 2, 3600, False))
    zero = "00000000-0000-4000-8000-000000000000"
    assert _confirm(client, token, zero).status_code == 404
    assert _confirm(client, token, zero).status_code == 404
    limited = _confirm(client, token, zero)
    assert limited.status_code == 429
    assert "Retry-After" in limited.headers


def test_simultaneous_confirmations_run_the_action_exactly_once(app, client, world):
    import threading

    ana_token, ana_id = world["ana"]
    beto_id = world["beto"][1]
    [card] = _cards(_propose(app, client, ana_token, "propose_follow_user", {"username": "beto"})[0])

    workers = 8
    barrier = threading.Barrier(workers)
    results = []

    def attempt():
        local = app.test_client()
        barrier.wait()
        results.append(_confirm(local, ana_token, card["id"]))

    threads = [threading.Thread(target=attempt) for _ in range(workers)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert [r.status_code for r in results] == [200] * workers
    # Solo una petición ganó la fila y ejecutó; las demás reciben la respuesta idempotente.
    executed = [r for r in results if "result" in r.get_json()]
    assert len(executed) == 1
    assert _follows(app, ana_id, beto_id) == 1
    assert _count(app, "SELECT count(*) FROM notifications WHERE recipient_id = :u", u=beto_id) == 1


def test_old_actions_are_purged_with_the_other_technical_data_and_recent_ones_are_kept(app, client, world):
    from datetime import datetime, timezone

    from app.application.retention.purge_use_case import purge_expired_data
    from app.infrastructure.persistence.repositories.retention_repository import (
        SQLAlchemyRetentionRepository,
    )

    token, _ = world["ana"]
    old = _cards(_propose(app, client, token, "propose_update_profile", {"bio": "vieja"})[0])[0]
    recent = _cards(_propose(app, client, token, "propose_update_profile", {"bio": "nueva"})[0])[0]
    with app.app_context():
        db.session.execute(
            text("UPDATE tero_pending_actions SET created_at = now() - interval '100 days' WHERE id = :i"),
            {"i": old["id"]},
        )
        db.session.commit()
        counts = purge_expired_data(SQLAlchemyRetentionRepository(), now=datetime.now(timezone.utc))
    assert counts["tero_pending_actions"] == 1
    assert _count(app, "SELECT count(*) FROM tero_pending_actions WHERE id = :i", i=old["id"]) == 0
    assert _count(app, "SELECT count(*) FROM tero_pending_actions WHERE id = :i", i=recent["id"]) == 1
