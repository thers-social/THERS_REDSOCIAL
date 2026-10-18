# Automatizaciones con n8n (ADR-041 §7): firma, eventos y cliente HTTP. NINGUNA prueba llama a un n8n
# real: el cliente se prueba con un abridor falso y con un servidor HTTP local.

import json
import threading
import urllib.error
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from app.domain.automations import events, signing
from app.domain.automations.client import AutomationDeliveryError
from app.infrastructure.automations.n8n_client import N8nClient, NullAutomationClient, webhook_path

SECRET = "secreto-compartido-de-prueba"
NOW = 1_800_000_000


# --- Firma --------------------------------------------------------------------------------------


def test_a_signature_round_trips():
    body = b'{"a":1}'
    signature = signing.sign(SECRET, NOW, body)
    assert signature.startswith("sha256=")
    assert signing.verify(SECRET, NOW, signature, body, now=NOW)


@pytest.mark.parametrize(
    "mutate",
    [
        lambda s, t, b: (s, t, b + b" "),                      # cuerpo alterado
        lambda s, t, b: (s, t + 1, b),                         # marca de tiempo distinta
        lambda s, t, b: (s[:-1] + ("0" if s[-1] != "0" else "1"), t, b),   # firma alterada
        lambda s, t, b: ("sha256=" + "0" * 64, t, b),
    ],
)
def test_any_change_to_the_message_invalidates_the_signature(mutate):
    body = b'{"user":"x"}'
    signature, timestamp, body2 = mutate(signing.sign(SECRET, NOW, body), NOW, body)
    assert not signing.verify(SECRET, timestamp, signature, body2, now=NOW)


def test_a_different_secret_never_verifies():
    signature = signing.sign(SECRET, NOW, b"x")
    assert not signing.verify("otro-secreto", NOW, signature, b"x", now=NOW)


def test_old_and_future_timestamps_are_rejected_so_a_capture_cannot_be_replayed():
    signature = signing.sign(SECRET, NOW, b"x")
    skew = signing.MAX_CLOCK_SKEW_SECONDS
    assert signing.verify(SECRET, NOW, signature, b"x", now=NOW + skew)
    assert not signing.verify(SECRET, NOW, signature, b"x", now=NOW + skew + 1)
    assert not signing.verify(SECRET, NOW, signature, b"x", now=NOW - skew - 1)


@pytest.mark.parametrize("timestamp", [None, "", "no-es-un-numero", "1.5e9", [1]])
def test_a_malformed_timestamp_is_rejected_without_raising(timestamp):
    assert not signing.verify(SECRET, timestamp, "sha256=abc", b"x", now=NOW)


@pytest.mark.parametrize("secret,signature,body", [("", "sha256=x", b"x"), (SECRET, "", b"x"), (SECRET, None, b"x"), (SECRET, "sha256=x", None)])
def test_missing_pieces_never_verify(secret, signature, body):
    assert not signing.verify(secret, NOW, signature, body, now=NOW)


# --- Eventos ------------------------------------------------------------------------------------


def test_idempotency_keys_are_stable_and_distinguish_events_and_things():
    a = events.idempotency_key("report_resolved", "r1")
    assert a == events.idempotency_key("report_resolved", "r1")
    assert a != events.idempotency_key("report_resolved", "r2")
    assert a != events.idempotency_key("weekly_summary", "r1")
    assert len(a) == 64


def test_only_closed_statuses_have_an_outcome_and_it_is_generic():
    assert events.outcome_for_status("actioned") == events.OUTCOME_ACTIONED
    assert events.outcome_for_status("dismissed") == events.OUTCOME_DISMISSED
    for status in ("open", "reviewing", "", None, "otro"):
        assert events.outcome_for_status(status) is None


def test_the_report_payload_carries_only_what_an_email_needs():
    payload = events.report_resolved_payload("rep-1", "actioned", "ana@example.com")
    assert payload == {
        "event": "report_resolved",
        "report_id": "rep-1",
        "outcome": "actioned",
        "recipient_email": "ana@example.com",
        "language": "es",
    }


def test_the_week_starts_on_monday_in_utc():
    wednesday = datetime(2026, 10, 14, 15, 30, tzinfo=timezone.utc)
    assert events.week_start(wednesday) == datetime(2026, 10, 12, tzinfo=timezone.utc)
    sunday = datetime(2026, 10, 18, 23, 59, tzinfo=timezone.utc)
    assert events.week_start(sunday) == datetime(2026, 10, 12, tzinfo=timezone.utc)
    monday = datetime(2026, 10, 19, 0, 0, tzinfo=timezone.utc)
    assert events.week_start(monday) == datetime(2026, 10, 19, tzinfo=timezone.utc)


def test_the_summary_covers_the_whole_finished_week_not_the_one_in_progress():
    start, end = events.summary_period(datetime(2026, 10, 14, 9, 0, tzinfo=timezone.utc))
    assert (start, end) == (
        datetime(2026, 10, 5, tzinfo=timezone.utc),
        datetime(2026, 10, 12, tzinfo=timezone.utc),
    )


def test_the_weekly_key_is_one_per_person_and_week():
    end = datetime(2026, 10, 12, tzinfo=timezone.utc)
    next_week = datetime(2026, 10, 19, tzinfo=timezone.utc)
    assert events.weekly_summary_key("u1", end) == events.weekly_summary_key("u1", end)
    assert events.weekly_summary_key("u1", end) != events.weekly_summary_key("u2", end)
    assert events.weekly_summary_key("u1", end) != events.weekly_summary_key("u1", next_week)


# --- Cliente (abridor falso) -----------------------------------------------------------------


class FakeResponse:
    def __init__(self, status):
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class FakeOpener:
    """Responde con la lista de resultados, en orden: un entero es un estado HTTP; una excepción se
    lanza. Guarda cada petición recibida."""

    def __init__(self, *results):
        self.results = list(results)
        self.requests = []
        self.timeouts = []

    def __call__(self, request, timeout):
        self.requests.append(request)
        self.timeouts.append(timeout)
        result = self.results[min(len(self.requests) - 1, len(self.results) - 1)]
        if isinstance(result, Exception):
            raise result
        return FakeResponse(result)


def _http_error(code):
    return urllib.error.HTTPError("http://n8n", code, "x", {}, None)


def _client(opener, retries=2, clock=None):
    ticks = iter(range(NOW, NOW + 100))
    return N8nClient(
        "https://n8n.example.com/", SECRET, timeout_seconds=3.5, max_retries=retries,
        opener=opener, sleep=lambda seconds: None, clock=clock or (lambda: next(ticks)),
    )


def test_a_successful_send_is_signed_idempotent_and_goes_to_the_right_webhook():
    opener = FakeOpener(200)
    payload = {"event": "report_resolved", "report_id": "r1", "note": "ñandú"}
    assert _client(opener).send("report_resolved", payload, "clave-1") is True

    request = opener.requests[0]
    assert request.full_url == "https://n8n.example.com/webhook/thers-report-resolved"
    assert webhook_path("weekly_summary") == "/webhook/thers-weekly-summary"
    assert request.get_method() == "POST"
    headers = {k.lower(): v for k, v in request.header_items()}
    assert headers["x-thers-idempotency-key"] == "clave-1"
    assert headers["content-type"] == "application/json"
    assert opener.timeouts == [3.5]
    # n8n puede verificar la firma con el secreto compartido sobre el cuerpo EXACTO.
    assert signing.verify(
        SECRET, headers["x-thers-timestamp"], headers["x-thers-signature"], request.data, now=NOW + 5
    )
    assert json.loads(request.data.decode("utf-8")) == payload


def test_transient_failures_are_retried_with_the_same_idempotency_key_and_a_fresh_timestamp():
    opener = FakeOpener(500, urllib.error.URLError("sin red"), 200)
    assert _client(opener).send("report_resolved", {"x": 1}, "k") is True

    assert len(opener.requests) == 3
    keys = {dict((k.lower(), v) for k, v in r.header_items())["x-thers-idempotency-key"] for r in opener.requests}
    stamps = [dict((k.lower(), v) for k, v in r.header_items())["x-thers-timestamp"] for r in opener.requests]
    assert keys == {"k"}
    assert len(set(stamps)) == 3


def test_it_gives_up_after_the_configured_retries():
    opener = FakeOpener(503)
    with pytest.raises(AutomationDeliveryError):
        _client(opener, retries=2).send("report_resolved", {}, "k")
    assert len(opener.requests) == 3


def test_a_client_error_is_final_and_is_not_retried():
    for code in (400, 401, 403, 404, 422):
        opener = FakeOpener(_http_error(code))
        with pytest.raises(AutomationDeliveryError):
            _client(opener).send("report_resolved", {}, "k")
        assert len(opener.requests) == 1, code


def test_timeouts_and_rate_limits_are_treated_as_transient():
    for code in (408, 429, 500, 502):
        opener = FakeOpener(_http_error(code), 200)
        assert _client(opener).send("report_resolved", {}, "k") is True
        assert len(opener.requests) == 2, code
    opener = FakeOpener(TimeoutError("lento"), 200)
    assert _client(opener).send("report_resolved", {}, "k") is True


def test_the_error_and_the_logs_never_contain_the_payload_or_the_secret(caplog):
    payload = {"recipient_email": "secreto@example.com"}
    caplog.set_level("DEBUG")
    with pytest.raises(AutomationDeliveryError) as caught:
        _client(FakeOpener(500)).send("report_resolved", payload, "k")
    text = str(caught.value) + caplog.text
    assert "secreto@example.com" not in text
    assert SECRET not in text


@pytest.mark.parametrize("url", ["", None, "ftp://n8n", "file:///etc/passwd", "n8n.example.com", "http://"])
def test_only_http_urls_are_accepted(url):
    with pytest.raises(ValueError):
        N8nClient(url, SECRET)


def test_a_secret_is_mandatory():
    with pytest.raises(ValueError):
        N8nClient("https://n8n.example.com", "")


def test_the_background_runner_runs_the_task_off_the_request_and_swallows_failures():
    from app.infrastructure.automations.factory import run_in_background

    done = threading.Event()
    run_in_background(done.set)
    assert done.wait(2)

    # Un fallo dentro del hilo no escapa: avisar a n8n nunca puede romper nada.
    failed = threading.Event()

    def boom():
        try:
            raise RuntimeError("falló")
        finally:
            failed.set()

    run_in_background(boom)
    assert failed.wait(2)


def test_the_factory_builds_a_null_client_unless_everything_is_configured():
    from app.infrastructure.automations.factory import create_client

    assert create_client({}).name == "null"
    assert create_client({"TERO_AUTOMATIONS_ENABLED": True}).name == "null"
    assert create_client({"TERO_AUTOMATIONS_ENABLED": True, "N8N_BASE_URL": "https://n8n.example.com"}).name == "null"
    assert create_client({"N8N_BASE_URL": "https://n8n.example.com", "N8N_WEBHOOK_SECRET": "s"}).name == "null"
    full = {
        "TERO_AUTOMATIONS_ENABLED": True, "N8N_BASE_URL": "https://n8n.example.com",
        "N8N_WEBHOOK_SECRET": "s", "N8N_TIMEOUT_SECONDS": 5.0, "N8N_MAX_RETRIES": 2,
    }
    assert create_client(full).name == "n8n"


def test_the_null_client_sends_nothing_and_does_not_fail():
    assert NullAutomationClient().send("report_resolved", {}, "k") is False


# --- Cliente contra un servidor HTTP real y local -----------------------------------------------


class _Recorder(BaseHTTPRequestHandler):
    received = []
    status = 200

    def do_POST(self):  # noqa: N802 -- nombre que exige BaseHTTPRequestHandler
        length = int(self.headers.get("Content-Length", 0))
        _Recorder.received.append((self.path, dict(self.headers), self.rfile.read(length)))
        self.send_response(_Recorder.status)
        self.end_headers()

    def log_message(self, *args):
        pass


def test_end_to_end_against_a_local_http_server_the_signature_verifies():
    _Recorder.received = []
    _Recorder.status = 200
    server = HTTPServer(("127.0.0.1", 0), _Recorder)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        client = N8nClient(f"http://127.0.0.1:{server.server_port}", SECRET, timeout_seconds=3)
        assert client.send("report_resolved", {"report_id": "r1", "outcome": "dismissed"}, "clave") is True
    finally:
        server.shutdown()
        server.server_close()

    path, raw_headers, body = _Recorder.received[0]
    # Los nombres de encabezado no distinguen mayúsculas (n8n los recibe en minúsculas).
    headers = {name.lower(): value for name, value in raw_headers.items()}
    assert path == "/webhook/thers-report-resolved"
    assert headers["x-thers-idempotency-key"] == "clave"
    assert signing.verify(
        SECRET, headers["x-thers-timestamp"], headers["x-thers-signature"], body,
        now=int(datetime.now(timezone.utc).timestamp()),
    )
