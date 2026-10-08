# Pruebas del reporte de datos incorrectos de un lugar (ADR-040, fase 2).

import uuid

import pytest
from sqlalchemy import text

from app.domain.places import kinds
from app.domain.rate_limiting import policy
from app.extensions import db
from tests.places.helpers import auth, insert_place, make_users


@pytest.fixture()
def setup(app, client):
    users = make_users(app, client)
    with app.app_context():
        place_id = insert_place("Café Aurora")
    return users, place_id


def _report(client, token, place_id, **body):
    return client.post(f"/api/places/{place_id}/report", json=body, headers=auth(token))


def _count(app, sql="SELECT count(*) FROM place_reports", **params):
    with app.app_context():
        return db.session.execute(text(sql), params).scalar()


def test_report_a_place(client, app, setup):
    users, place_id = setup
    token, user_id = users["ana"]

    response = _report(client, token, place_id, reason="wrong_phone", details="El teléfono no contesta")

    assert response.status_code == 201
    report = response.get_json()["report"]
    assert report["reason"] == "wrong_phone"
    assert report["status"] == "open"
    assert report["place_id"] == place_id
    assert set(report) == {"id", "place_id", "reason", "status", "created_at"}
    assert _count(app, "SELECT count(*) FROM place_reports WHERE reporter_id = :u", u=user_id) == 1


@pytest.mark.parametrize("reason", kinds.REPORT_REASONS)
def test_every_documented_reason_is_accepted(client, setup, reason):
    users, place_id = setup

    response = _report(client, users["ana"][0], place_id, reason=reason, details="detalle")

    assert response.status_code == 201


def test_the_same_open_report_twice_is_idempotent(client, app, setup):
    users, place_id = setup
    token, _ = users["ana"]

    first = _report(client, token, place_id, reason="closed")
    second = _report(client, token, place_id, reason="closed")

    assert (first.status_code, second.status_code) == (201, 200)
    assert first.get_json()["report"]["id"] == second.get_json()["report"]["id"]
    assert _count(app) == 1


def test_a_different_reason_or_person_creates_another_report(client, app, setup):
    users, place_id = setup
    _report(client, users["ana"][0], place_id, reason="closed")
    _report(client, users["ana"][0], place_id, reason="wrong_name")
    _report(client, users["beto"][0], place_id, reason="closed")

    assert _count(app) == 3


def test_can_report_again_after_the_first_one_was_closed(client, app, setup):
    users, place_id = setup
    token, _ = users["ana"]
    _report(client, token, place_id, reason="closed")
    with app.app_context():
        db.session.execute(text("UPDATE place_reports SET status = 'dismissed'"))
        db.session.commit()

    assert _report(client, token, place_id, reason="closed").status_code == 201
    assert _count(app) == 2


# --- Validación y seguridad ------------------------------------------------


@pytest.mark.parametrize(
    "body, fragment",
    [
        ({}, "reason es obligatorio"),
        ({"reason": "inventado"}, "reason inválido"),
        ({"reason": 5}, "reason es obligatorio"),
        ({"reason": "other"}, "Cuéntanos qué pasa"),
        ({"reason": "other", "details": "   "}, "Cuéntanos qué pasa"),
        ({"reason": "closed", "details": "x" * 501}, "no puede superar 500"),
        ({"reason": "closed", "details": 12}, "details debe ser texto"),
        ({"reason": "closed", "details": "a\x00b"}, "caracteres no permitidos"),
    ],
)
def test_report_rejects_invalid_input(client, app, setup, body, fragment):
    users, place_id = setup

    response = _report(client, users["ana"][0], place_id, **body)

    assert response.status_code == 400
    assert fragment in response.get_json()["msg"]
    assert _count(app) == 0


def test_report_requires_a_json_object(client, setup):
    users, place_id = setup

    response = client.post(f"/api/places/{place_id}/report", data="no json", headers=auth(users["ana"][0]))

    assert response.status_code == 400


def test_report_requires_authentication(client, setup):
    _, place_id = setup

    assert client.post(f"/api/places/{place_id}/report", json={"reason": "closed"}).status_code == 401


def test_report_unknown_or_non_public_place_is_404(client, app, setup):
    users, _ = setup
    with app.app_context():
        hidden = insert_place("Oculto", status="pending")

    for target in (uuid.uuid4(), hidden):
        response = _report(client, users["ana"][0], target, reason="closed")
        assert response.status_code == 404
    assert _count(app) == 0


def test_report_ignores_forged_fields_in_the_body(client, app, setup):
    users, place_id = setup
    ana, ana_id = users["ana"]
    _, beto_id = users["beto"]

    response = _report(
        client, ana, place_id, reason="closed", reporter_id=beto_id, status="resolved",
        resolved_by_user_id=beto_id,
    )

    assert response.status_code == 201
    with app.app_context():
        reporter, status, resolver = db.session.execute(
            text("SELECT reporter_id::text, status, resolved_by_user_id FROM place_reports")
        ).one()
    assert (reporter, status, resolver) == (ana_id, "open", None)


def test_report_is_rate_limited_per_account(client, setup):
    users, place_id = setup
    ana, _ = users["ana"]
    beto, _ = users["beto"]
    reasons = list(kinds.REPORT_REASONS)

    for i in range(policy.PLACE_REPORT.limit):
        assert _report(client, ana, place_id, reason=reasons[i % len(reasons)], details="d").status_code in (200, 201)
    limited = _report(client, ana, place_id, reason="closed")

    assert limited.status_code == 429
    assert _report(client, beto, place_id, reason="closed").status_code == 201


def test_report_survives_the_reporter_deleting_the_account(client, app, setup):
    users, place_id = setup
    token, user_id = users["ana"]
    _report(client, token, place_id, reason="closed")

    with app.app_context():
        db.session.execute(text("DELETE FROM users WHERE id = :u"), {"u": user_id})
        db.session.commit()
        reporter = db.session.execute(text("SELECT reporter_id FROM place_reports")).scalar()

    assert reporter is None
    assert _count(app) == 1


def test_data_export_includes_the_persons_reports(client, app, setup):
    from app.infrastructure.persistence.repositories.data_export_repository import (
        SQLAlchemyDataExportRepository,
    )

    users, place_id = setup
    token, user_id = users["ana"]
    _report(client, token, place_id, reason="wrong_phone", details="No contesta")

    with app.app_context():
        data = SQLAlchemyDataExportRepository().collect_user_data(user_id)

    assert len(data["place_reports"]) == 1
    assert data["place_reports"][0]["reason"] == "wrong_phone"
    assert data["place_reports"][0]["place"] == "Café Aurora"
