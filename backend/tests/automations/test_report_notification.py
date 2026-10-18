# Aviso de reporte resuelto (ADR-041 §7): al cerrar un reporte, el backend le encarga a n8n un correo
# GENÉRICO para quien reportó. Se prueba que el aviso:
#   · solo sale cuando corresponde (automatizaciones encendidas, reportante con correo verificado
#     y cuenta activa, estado que se comunica);
#   · lleva únicamente lo que un correo necesita: sin nombres, contenido ni notas de moderación;
#   · nunca retrasa ni rompe la resolución, aunque n8n falle.
# NINGUNA prueba llama a un n8n real: el cliente es simulado y el ejecutor corre en el acto.

import pytest

from app.domain.automations import events
from app.domain.automations.client import AutomationClient, AutomationDeliveryError
from app.extensions import db
from app.infrastructure.persistence.models import Report, User
from tests.test_moderation import _report_row, _resolve, _setup
from tests.test_reports import _post, _report


class FakeClient(AutomationClient):
    name = "fake"

    def __init__(self, error=None):
        self.sent = []
        self.error = error

    def send(self, event_type, payload, idempotency_key):
        self.sent.append((event_type, payload, idempotency_key))
        if self.error:
            raise self.error
        return True


def _install(app, client):
    app.extensions["thers_automations"] = {"client": client, "runner": lambda task: task()}
    return client


@pytest.fixture()
def world(app, client):
    """Una moderadora, una autora con una publicación y una persona que la reportó."""
    s = _setup(app, client)
    post_id = _post(client, s["author"], "publicación a reportar")
    assert _report(client, s["reporter"], "post", post_id).status_code == 201
    with app.app_context():
        report_id = str(db.session.query(Report).one().id)
    fake = _install(app, FakeClient())
    return s, report_id, fake


def _set(app, user_id, **fields):
    with app.app_context():
        user = db.session.get(User, user_id)
        for key, value in fields.items():
            setattr(user, key, value)
        db.session.commit()


# --- Cuándo se avisa -----------------------------------------------------------------------------


def test_dismissing_a_report_notifies_the_reporter(app, client, world):
    s, report_id, fake = world
    response = _resolve(client, s["mod"], report_id, "dismiss", note="sin infracción")
    assert response.status_code == 200

    [(event, payload, key)] = fake.sent
    assert event == events.EVENT_REPORT_RESOLVED
    assert payload["outcome"] == events.OUTCOME_DISMISSED
    assert payload["recipient_email"] == "reportante@example.com"
    assert key == events.idempotency_key(events.EVENT_REPORT_RESOLVED, report_id)


def test_acting_on_a_report_notifies_with_the_generic_actioned_outcome(app, client, world):
    s, report_id, fake = world
    assert _resolve(client, s["mod"], report_id, "remove_content").status_code == 200
    assert fake.sent[0][1]["outcome"] == events.OUTCOME_ACTIONED


def test_the_payload_has_exactly_the_minimum_and_nothing_about_who_or_what(app, client, world):
    s, report_id, fake = world
    _resolve(client, s["mod"], report_id, "remove_content", note="NOTA-INTERNA-DE-MODERACION")

    payload = fake.sent[0][1]
    assert set(payload) == {"event", "report_id", "outcome", "recipient_email", "language"}
    text = str(payload)
    for forbidden in ("autora", "publicación a reportar", "NOTA-INTERNA", "moderadora", "spam"):
        assert forbidden not in text


# --- Cuándo NO se avisa --------------------------------------------------------------------------


def test_nothing_is_sent_when_the_automations_are_off(app, client, world):
    s, report_id, _ = world
    from app.infrastructure.automations.n8n_client import NullAutomationClient

    _install(app, NullAutomationClient())
    assert _resolve(client, s["mod"], report_id, "dismiss").status_code == 200
    # La resolución sigue funcionando y el estado quedó guardado.
    assert _report_row(app, report_id).status == "dismissed"


def test_an_unverified_reporter_is_not_emailed(app, client, world):
    s, report_id, fake = world
    _set(app, s["reporter_id"], email_verified=False)
    assert _resolve(client, s["mod"], report_id, "dismiss").status_code == 200
    assert fake.sent == []


def test_a_suspended_reporter_is_not_emailed(app, client, world):
    s, report_id, fake = world
    _set(app, s["reporter_id"], suspended_at=db.func.now())
    assert _resolve(client, s["mod"], report_id, "dismiss").status_code == 200
    assert fake.sent == []


def test_a_report_whose_reporter_deleted_the_account_notifies_nobody(app, client, world):
    s, report_id, fake = world
    with app.app_context():
        db.session.query(Report).update({"reporter_id": None})
        db.session.commit()
    assert _resolve(client, s["mod"], report_id, "dismiss").status_code == 200
    assert fake.sent == []


def test_resolving_twice_does_not_notify_twice(app, client, world):
    s, report_id, fake = world
    assert _resolve(client, s["mod"], report_id, "dismiss").status_code == 200
    assert _resolve(client, s["mod"], report_id, "dismiss").status_code == 409
    assert len(fake.sent) == 1


def test_an_open_status_is_never_communicated():
    assert events.outcome_for_status("open") is None


# --- n8n caído ---------------------------------------------------------------------------------


def test_a_failing_n8n_never_breaks_the_resolution(app, client, world):
    s, report_id, _ = world
    _install(app, FakeClient(error=AutomationDeliveryError("n8n caído")))
    response = _resolve(client, s["mod"], report_id, "dismiss")
    assert response.status_code == 200
    assert response.get_json()["report"]["status"] == "dismissed"


def test_an_unexpected_error_in_the_notifier_does_not_break_it_either(app, client, world, monkeypatch):
    s, report_id, _ = world

    def boom(*args, **kwargs):
        raise RuntimeError("fallo inesperado")

    monkeypatch.setattr(
        "app.application.automations.notifier.AutomationNotifier.report_resolved", boom
    )
    assert _resolve(client, s["mod"], report_id, "dismiss").status_code == 200
    assert _report_row(app, report_id).status == "dismissed"


def test_the_response_to_the_moderator_is_unchanged_by_the_notification(app, client, world):
    s, report_id, _ = world
    body = _resolve(client, s["mod"], report_id, "dismiss").get_json()
    assert set(body) == {"report"}
    assert set(body["report"]) == {"id", "status", "action"}
