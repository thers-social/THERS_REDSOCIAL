# Automatización con n8n (ADR-044 §2.8). NINGUNA prueba usa red, cuenta ni URL real: el transporte es
# simulado. n8n solo AVISA: se comprueba que no puede decidir nada, que la firma es estricta, que
# nada personal viaja y que un fallo suyo no toca la moderación.

import json
import time
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from app.application.automation import alerts
from app.application.automation.dispatch import dispatch_batch
from app.application.content_moderation.process_jobs import process_next
from app.domain.automation import events
from app.extensions import db
from app.infrastructure.automation.transports import (
    HttpWebhookTransport,
    RecordingTransport,
    build_transport,
)
from app.infrastructure.content_moderation.fake_classifiers import (
    FailingImageClassifier,
    FakeImageClassifier,
)
from app.infrastructure.persistence.repositories.domain_event_repository import (
    SQLAlchemyDomainEventRepository,
)
from tests.content_moderation.conftest import make_account, now, publish_post_with_image
from tests.test_messages import _auth_headers

SECRET = "outbound-secret-for-tests"
INBOUND = "inbound-secret-for-tests"
UUID = "123e4567-e89b-42d3-a456-426614174000"


class RecordingEmail:
    def __init__(self, fail=False):
        self.sent, self.fail = [], fail

    def send(self, to, subject, html):
        if self.fail:
            raise RuntimeError("provider says: private detail")
        self.sent.append((to, subject, html))


# ----------------------------------------------------------------------------- the event schema


class TestEventSchema:
    def test_a_valid_event_is_accepted(self):
        out = events.build_event(events.CRITICAL_HELD, {
            "subject_type": "story", "subject_id": UUID, "priority": "critical", "reason": "severe_signal"})
        assert out["subject_id"] == UUID

    @pytest.mark.parametrize("fields", [
        {"subject_type": "story", "subject_id": UUID, "priority": "critical"},  # falta uno
        {"subject_type": "story", "subject_id": UUID, "priority": "critical", "reason": "x",
         "text": "contenido privado"},  # sobra uno
        {"subject_type": "story", "subject_id": UUID, "priority": "critical", "email": "a@b.com"},
        {"subject_type": "story", "subject_id": "not-a-uuid", "priority": "critical", "reason": "x"},
        {"subject_type": "Story With Spaces", "subject_id": UUID, "priority": "critical", "reason": "x"},
        {"subject_type": "story", "subject_id": UUID, "priority": "critical", "reason": "x" * 80},
    ])
    def test_extra_missing_or_malformed_fields_are_rejected(self, fields):
        with pytest.raises(events.InvalidEventError):
            events.build_event(events.CRITICAL_HELD, fields)

    def test_unknown_event_types_and_non_dicts_are_rejected(self):
        for bad in (("moderation.approve", {}), (events.JOB_DEAD, None), (events.JOB_DEAD, [])):
            with pytest.raises(events.InvalidEventError):
                events.build_event(*bad)

    def test_counts_must_be_plain_non_negative_integers(self):
        ok = {"job_id": UUID, "subject_type": "story", "attempts": 5}
        assert events.build_event(events.JOB_DEAD, ok)
        for bad in (-1, True, 1.5, "5", 10**9):
            with pytest.raises(events.InvalidEventError):
                events.build_event(events.JOB_DEAD, {**ok, "attempts": bad})

    def test_there_is_no_event_type_that_could_decide_anything(self):
        for name in events.SCHEMAS:
            assert not any(word in name for word in ("approve", "reject", "suspend", "ban", "decide"))
        for schema in events.SCHEMAS.values():
            assert not {"content", "text", "email", "name", "url", "storage_key", "snapshot"} & set(schema)


# ----------------------------------------------------------------------------------- signatures


class TestSignature:
    BODY = b'{"a":1}'

    def test_a_fresh_correct_signature_verifies(self):
        header = events.sign(SECRET, 1_000_000, self.BODY)
        assert events.verify(SECRET, header, self.BODY, 1_000_010)

    def test_tampered_body_wrong_secret_and_missing_header_fail(self):
        header = events.sign(SECRET, 1_000_000, self.BODY)
        assert not events.verify(SECRET, header, b'{"a":2}', 1_000_010)
        assert not events.verify("other-secret", header, self.BODY, 1_000_010)
        assert not events.verify(SECRET, None, self.BODY, 1_000_010)
        assert not events.verify(None, header, self.BODY, 1_000_010)
        assert not events.verify("", header, self.BODY, 1_000_010)

    def test_old_or_future_signatures_are_rejected(self):
        header = events.sign(SECRET, 1_000_000, self.BODY)
        assert not events.verify(SECRET, header, self.BODY, 1_000_000 + events.TOLERANCE_SECONDS + 1)
        assert not events.verify(SECRET, header, self.BODY, 1_000_000 - events.TOLERANCE_SECONDS - 1)

    def test_changing_the_timestamp_invalidates_the_signature(self):
        header = events.sign(SECRET, 1_000_000, self.BODY)
        forged = header.replace("t=1000000", "t=1000100")
        assert not events.verify(SECRET, forged, self.BODY, 1_000_100)

    @pytest.mark.parametrize("header", ["", "garbage", "t=abc,v1=ff", "v1=ff", "t=1", "t=1,v1=", ",,,", "t=1,v1=zz"])
    def test_malformed_headers_are_false_never_an_exception(self, header):
        assert events.verify(SECRET, header, self.BODY, 1) is False

    def test_the_body_is_canonical(self):
        assert events.body_bytes({"b": 1, "a": 2}) == events.body_bytes({"a": 2, "b": 1}) == b'{"a":2,"b":1}'


# ----------------------------------------------------------------------------------- transports


class TestTransports:
    @pytest.mark.parametrize("url", ["http://example.com/hook", "ftp://x/y", "", None, "example.com"])
    def test_only_https_or_localhost_is_accepted(self, url):
        with pytest.raises(ValueError):
            HttpWebhookTransport(url)

    def test_https_and_local_http_are_accepted(self):
        HttpWebhookTransport("https://hooks.example.test/x")
        HttpWebhookTransport("http://localhost:5678/x")

    def test_without_configuration_there_is_no_transport(self):
        assert build_transport({}) is None
        assert build_transport({"N8N_ENABLED": True}) is None
        assert build_transport({"N8N_ENABLED": True, "N8N_WEBHOOK_URL": "https://h.test/x"}) is None
        assert build_transport({"N8N_WEBHOOK_URL": "https://h.test/x", "N8N_OUTBOUND_SECRET": "s"}) is None
        assert build_transport({"N8N_ENABLED": True, "N8N_WEBHOOK_URL": "https://h.test/x",
                                "N8N_OUTBOUND_SECRET": "s"}) is not None

    def test_the_http_transport_does_not_follow_redirects(self, monkeypatch):
        seen = {}

        class Resp:
            status_code = 200

        def fake_post(url, **kwargs):
            seen.update(kwargs)
            return Resp()

        monkeypatch.setattr("requests.post", fake_post)
        HttpWebhookTransport("https://h.test/x").send(b"{}", {"X": "1"})
        assert seen["allow_redirects"] is False and seen["timeout"] == 5.0

    def test_a_non_2xx_answer_is_a_transport_error_without_body_or_url(self, monkeypatch):
        from app.application.automation.dispatch import TransportError

        class Resp:
            status_code = 500
            text = "secret server detail"

        monkeypatch.setattr("requests.post", lambda *a, **k: Resp())
        with pytest.raises(TransportError) as caught:
            HttpWebhookTransport("https://h.test/x").send(b"{}", {})
        assert "secret" not in str(caught.value) and "h.test" not in str(caught.value)


# -------------------------------------------------------------------------------- the outbox


def _enqueue(repo, n=1):
    for i in range(n):
        repo.enqueue(events.JOB_DEAD, {"job_id": UUID, "subject_type": "story", "attempts": 5}, i)
    repo.commit()


def _rows():
    return db.session.execute(text("SELECT * FROM domain_events ORDER BY created_at")).mappings().all()


class TestOutbox:
    def test_enqueueing_the_same_fact_twice_keeps_one_event(self, app):
        with app.app_context():
            repo = SQLAlchemyDomainEventRepository()
            repo.enqueue(events.JOB_DEAD, {"job_id": UUID, "subject_type": "story", "attempts": 5}, "k")
            repo.enqueue(events.JOB_DEAD, {"job_id": UUID, "subject_type": "story", "attempts": 5}, "k")
            repo.commit()
            assert len(_rows()) == 1

    def test_an_invalid_event_never_reaches_the_table(self, app):
        with app.app_context():
            repo = SQLAlchemyDomainEventRepository()
            with pytest.raises(events.InvalidEventError):
                repo.enqueue(events.JOB_DEAD, {"job_id": UUID, "text": "private"}, "k")
            assert _rows() == []

    def test_dispatch_sends_signed_canonical_bodies_and_marks_them_sent(self, app):
        with app.app_context():
            repo, transport = SQLAlchemyDomainEventRepository(), RecordingTransport()
            _enqueue(repo, 2)

            counts = dispatch_batch(repo, transport, SECRET, now())

            assert counts == {"sent": 2, "failed": 0, "dead": 0}
            body, headers = transport.sent[0]
            assert events.verify(SECRET, headers[events.SIGNATURE_HEADER], body, time.time())
            assert json.loads(body)["type"] == "moderation.job_dead"
            assert {r["status"] for r in _rows()} == {"sent"}

    def test_sent_events_are_not_sent_again(self, app):
        with app.app_context():
            repo, transport = SQLAlchemyDomainEventRepository(), RecordingTransport()
            _enqueue(repo)
            dispatch_batch(repo, transport, SECRET, now())
            dispatch_batch(repo, transport, SECRET, now())
            assert len(transport.sent) == 1

    def test_without_a_transport_or_a_secret_events_wait(self, app):
        with app.app_context():
            repo = SQLAlchemyDomainEventRepository()
            _enqueue(repo)
            assert dispatch_batch(repo, None, SECRET, now()) == {"sent": 0, "failed": 0, "dead": 0}
            assert dispatch_batch(repo, RecordingTransport(), "", now()) == {"sent": 0, "failed": 0, "dead": 0}
            assert [r["status"] for r in _rows()] == ["queued"]

    def test_failures_retry_with_backoff_and_end_up_dead(self, app):
        with app.app_context():
            repo = SQLAlchemyDomainEventRepository()
            transport = RecordingTransport(fail_with=RuntimeError("n8n down: secret url"))
            _enqueue(repo)
            t = now()

            assert dispatch_batch(repo, transport, SECRET, t)["failed"] == 1
            [row] = _rows()
            assert row["status"] == "failed" and row["last_error"] == "RuntimeError"
            # Aún no toca: nada que reclamar antes de la espera.
            assert dispatch_batch(repo, transport, SECRET, t) == {"sent": 0, "failed": 0, "dead": 0}

            outcomes = []
            for _ in range(10):
                t += timedelta(hours=2)
                outcomes.append(dispatch_batch(repo, transport, SECRET, t))
            assert sum(o["dead"] for o in outcomes) == 1
            assert _rows()[0]["status"] == "dead"
            t += timedelta(days=5)
            assert dispatch_batch(repo, RecordingTransport(), SECRET, t)["sent"] == 0  # muerto: no se reenvía


# --------------------------------------------------------------- moderation never depends on n8n


class TestModerationDoesNotDependOnN8n:
    def _held_critical(self, app, client, repository, settings, events_repo=None, alerter=None):
        token, _ = make_account(client, "autora")
        publish_post_with_image(client, token)
        return process_next(repository, FakeImageClassifier(default_scores={"child_safety": 0.5}),
                            settings, "w", now(), events=events_repo, alerter=alerter)

    def test_a_critical_decision_stores_the_event_in_the_same_transaction(
        self, app, client, moderation_on, repository, settings
    ):
        with app.app_context():
            self._held_critical(app, client, repository, settings, SQLAlchemyDomainEventRepository())
            [row] = _rows()
            assert row["event_type"] == "moderation.critical_held"
            assert row["payload"]["priority"] == "critical"
            # Sin contenido, sin correo, sin clave de archivo.
            assert set(row["payload"]) == {"subject_type", "subject_id", "priority", "reason"}
            assert db.session.execute(text("SELECT moderation_status FROM media_attachments")).scalar() == "held"

    def test_the_team_is_emailed_directly_even_with_n8n_off(
        self, app, client, moderation_on, repository, settings
    ):
        with app.app_context():
            mail = RecordingEmail()
            alerter = alerts.TeamAlerter(mail, "equipo@example.test", "https://panel.example.test/moderation")
            self._held_critical(app, client, repository, settings, SQLAlchemyDomainEventRepository(), alerter)
            [(to, subject, html)] = mail.sent
            assert to == "equipo@example.test" and "crítico" in subject.lower()
            assert "child_safety" not in html and "autora" not in html  # sin contenido ni nombres

    def test_a_broken_event_outbox_never_approves_and_the_job_is_retried(
        self, app, client, moderation_on, repository, settings
    ):
        class Broken:
            def enqueue(self, *a, **k):
                raise RuntimeError("outbox down")

            def commit(self):
                pass

            def rollback(self):
                pass

        with app.app_context():
            outcome = self._held_critical(app, client, repository, settings, Broken())
            # La decisión y su evento van en la misma transacción: si el evento falla, se deshace
            # todo, el contenido sigue `pending` y el trabajo se reintenta. Nunca queda aprobado.
            assert outcome[1] == "failed"
            status = db.session.execute(text("SELECT moderation_status FROM media_attachments")).scalar()
            assert status == "pending"
            assert db.session.execute(text("SELECT count(*) FROM admin_audit_log")).scalar() == 0

    def test_a_dead_job_emits_an_event_without_changing_the_content(
        self, app, client, moderation_on, repository, settings
    ):
        with app.app_context():
            token, _ = make_account(client, "autora")
            publish_post_with_image(client, token)
            repo, t = SQLAlchemyDomainEventRepository(), now()
            for _ in range(settings.max_attempts):
                t += timedelta(hours=2)
                process_next(repository, FailingImageClassifier(), settings, "w", t, events=repo)
            [row] = _rows()
            assert row["event_type"] == "moderation.job_dead" and row["payload"]["attempts"] == settings.max_attempts
            assert db.session.execute(text("SELECT moderation_status FROM media_attachments")).scalar() == "pending"

    def test_a_failing_email_provider_never_raises(self):
        alerter = alerts.TeamAlerter(RecordingEmail(fail=True), "equipo@example.test", "")
        assert alerter.alert("report_critical") is False

    def test_no_recipient_or_unknown_kind_sends_nothing(self):
        mail = RecordingEmail()
        assert alerts.TeamAlerter(mail, None, "").alert("report_critical") is False
        assert alerts.TeamAlerter(mail, "a@b.test", "").alert("delete_everything") is False
        assert mail.sent == []

    def test_the_alert_email_escapes_the_panel_link(self):
        mail = RecordingEmail()
        alerts.TeamAlerter(mail, "a@b.test", 'https://p.test/"><script>x</script>').alert("backlog")
        assert "<script>" not in mail.sent[0][2]


class TestCriticalReportsAreEmailedDirectly:
    def _report(self, client, token, target_id, reason):
        return client.post("/api/reports", json={"target_type": "user", "target_id": target_id,
                                                   "reason": reason}, headers=_auth_headers(token))

    def test_a_child_safety_report_emails_the_team_and_queues_an_event(self, app, client):
        with app.app_context():
            mail = RecordingEmail()
            app.extensions["team_alerter"] = alerts.TeamAlerter(mail, "equipo@example.test", "")
            reporter, _ = make_account(client, "reportante")
            _, target_id = make_account(client, "reportada")

            r = self._report(client, reporter, target_id, "child_safety")

            assert r.status_code == 201
            assert len(mail.sent) == 1 and "reporte crítico" in mail.sent[0][1].lower()
            assert _rows()[0]["event_type"] == "report.critical_created"

    def test_an_ordinary_report_sends_nothing(self, app, client):
        with app.app_context():
            mail = RecordingEmail()
            app.extensions["team_alerter"] = alerts.TeamAlerter(mail, "equipo@example.test", "")
            reporter, _ = make_account(client, "reportante")
            _, target_id = make_account(client, "reportada")
            assert self._report(client, reporter, target_id, "spam").status_code == 201
            assert mail.sent == [] and _rows() == []

    def test_the_report_is_saved_even_if_the_email_provider_fails(self, app, client):
        with app.app_context():
            app.extensions["team_alerter"] = alerts.TeamAlerter(RecordingEmail(fail=True), "a@b.test", "")
            reporter, _ = make_account(client, "reportante")
            _, target_id = make_account(client, "reportada")
            assert self._report(client, reporter, target_id, "child_safety").status_code == 201
            assert db.session.execute(text("SELECT count(*) FROM reports")).scalar() == 1

    def test_repeating_the_report_does_not_email_twice(self, app, client):
        with app.app_context():
            mail = RecordingEmail()
            app.extensions["team_alerter"] = alerts.TeamAlerter(mail, "equipo@example.test", "")
            reporter, _ = make_account(client, "reportante")
            _, target_id = make_account(client, "reportada")
            self._report(client, reporter, target_id, "child_safety")
            again = self._report(client, reporter, target_id, "child_safety")
            assert again.status_code == 200 and len(mail.sent) == 1


# ------------------------------------------------------------------- n8n -> Flask (internal)


def _signed(method, path, client, body=b"", secret=INBOUND, ts=None, **kwargs):
    header = events.sign(secret, ts if ts is not None else int(time.time()), body)
    return getattr(client, method)(
        path, data=body, headers={events.SIGNATURE_HEADER: header, "Content-Type": "application/json"}, **kwargs
    )


@pytest.fixture()
def n8n_on(app):
    app.config.update(N8N_ENABLED=True, N8N_INBOUND_SECRET=INBOUND)
    yield
    app.config.update(N8N_ENABLED=False, N8N_INBOUND_SECRET=None)


class TestInternalRoutes:
    def test_everything_is_404_when_n8n_is_off(self, app, client):
        with app.app_context():
            assert _signed("get", "/api/internal/moderation/summary", client).status_code == 404

    def test_without_the_secret_configured_even_a_valid_looking_call_is_404(self, app, client):
        with app.app_context():
            app.config.update(N8N_ENABLED=True, N8N_INBOUND_SECRET=None)
            assert _signed("get", "/api/internal/moderation/summary", client).status_code == 404

    def test_bad_missing_old_or_wrong_secret_signatures_are_all_404(self, app, client, n8n_on):
        with app.app_context():
            path = "/api/internal/moderation/summary"
            assert client.get(path).status_code == 404
            assert _signed("get", path, client, secret="wrong").status_code == 404
            assert _signed("get", path, client, ts=int(time.time()) - 3600).status_code == 404
            assert client.get(path, headers={events.SIGNATURE_HEADER: "garbage"}).status_code == 404
            # El secreto de SALIDA no sirve para la entrada.
            app.config["N8N_OUTBOUND_SECRET"] = SECRET
            assert _signed("get", path, client, secret=SECRET).status_code == 404

    def test_a_valid_call_returns_only_counts(self, app, client, n8n_on):
        with app.app_context():
            r = _signed("get", "/api/internal/moderation/summary", client)
            assert r.status_code == 200
            data = r.get_json()
            assert set(data) == {"held", "pending", "critical_held", "jobs_failed", "jobs_dead",
                                 "appeals_open", "appeals_overdue"}
            assert all(isinstance(v, int) for v in data.values())

    def test_a_signature_for_another_body_does_not_authorize_a_notice(self, app, client, n8n_on):
        with app.app_context():
            mail = RecordingEmail()
            app.extensions["team_alerter"] = alerts.TeamAlerter(mail, "equipo@example.test", "")
            header = events.sign(INBOUND, int(time.time()), b'{"kind":"backlog"}')
            r = client.post("/api/internal/notices", data=b'{"kind":"job_dead"}',
                            headers={events.SIGNATURE_HEADER: header, "Content-Type": "application/json"})
            assert r.status_code == 404 and mail.sent == []

    def test_a_valid_notice_sends_the_email_and_unknown_kinds_are_refused(self, app, client, n8n_on):
        with app.app_context():
            mail = RecordingEmail()
            app.extensions["team_alerter"] = alerts.TeamAlerter(mail, "equipo@example.test", "")
            ok = _signed("post", "/api/internal/notices", client, b'{"kind":"backlog"}')
            bad = _signed("post", "/api/internal/notices", client, b'{"kind":"approve_all"}')
            assert ok.status_code == 200 and ok.get_json() == {"delivered": True}
            assert bad.status_code == 400 and len(mail.sent) == 1

    def test_notices_are_rate_limited_globally(self, app, client, n8n_on):
        with app.app_context():
            app.extensions["team_alerter"] = alerts.TeamAlerter(RecordingEmail(), "equipo@example.test", "")
            codes = [_signed("post", "/api/internal/notices", client, b'{"kind":"backlog"}').status_code
                     for _ in range(22)]
            assert codes.count(200) == 20 and 429 in codes

    def test_n8n_has_no_way_to_decide_or_sanction(self, app, client, n8n_on):
        """Ninguna ruta interna, y ninguna ruta de moderación acepta la firma de n8n."""
        with app.app_context():
            internal = sorted(str(r) for r in app.url_map.iter_rules() if str(r).startswith("/api/internal"))
            assert internal == ["/api/internal/moderation/summary", "/api/internal/notices"]
            for path in ("/api/moderation/media", "/api/moderation/stats", "/api/moderation/audit"):
                assert _signed("get", path, client).status_code in (401, 404)
            fake_id = "123e4567-e89b-42d3-a456-426614174000"
            r = _signed("post", f"/api/moderation/media/{fake_id}/decision", client, b'{"decision":"approved"}')
            assert r.status_code in (401, 404)

    def test_the_summary_is_not_a_content_leak(self, app, client, n8n_on, moderation_on, repository, settings):
        with app.app_context():
            token, _ = make_account(client, "autora")
            publish_post_with_image(client, token)
            process_next(repository, FakeImageClassifier(default_scores={"violence": 0.6}), settings, "w", now())
            text_ = _signed("get", "/api/internal/moderation/summary", client).get_data(as_text=True)
            assert "autora" not in text_ and "storage" not in text_ and "posts/" not in text_
