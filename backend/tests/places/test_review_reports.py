# Reportar reseñas de lugares (ADR-040 fase 4a.2): se reutiliza `POST /api/reports` (ADR-032)
# con `target_type = "review"`. Cubre visibilidad (solo se reporta lo que se ve), bloqueos,
# idempotencia, motivos, prioridad crítica, la cola de moderación y el retiro del contenido.

import pytest
from sqlalchemy import text

from app.extensions import db
from tests.places.helpers import auth, insert_place, make_users
from tests.test_moderation import _queue, _resolve
from tests.test_reports import _report

MISSING = "00000000-0000-4000-8000-000000000000"


def _review_id(app, user_id):
    with app.app_context():
        return str(
            db.session.execute(text("SELECT id FROM place_reviews WHERE user_id = :u"), {"u": user_id}).scalar()
        )


@pytest.fixture()
def world(app, client):
    users = make_users(app, client, with_moderator=True)
    with app.app_context():
        place_id = insert_place("Café Aurora")
    # beto escribe una reseña que ana va a reportar.
    client.put(
        f"/api/places/{place_id}/review",
        json={"rating": 1, "body": "Compren pastillas baratas en mi sitio"},
        headers=auth(users["beto"][0]),
    )
    return users, place_id, _review_id(app, users["beto"][1])


def test_report_a_review(client, world):
    users, _, review_id = world

    response = _report(client, users["ana"][0], "review", review_id, reason="spam")

    assert response.status_code == 201
    body = response.get_json()["report"]
    assert body["target_type"] == "review" and body["target_id"] == review_id


def test_reporting_twice_is_idempotent(client, world):
    users, _, review_id = world
    first = _report(client, users["ana"][0], "review", review_id)
    second = _report(client, users["ana"][0], "review", review_id)
    assert first.status_code == 201 and second.status_code == 200
    assert second.get_json()["report"]["already_reported"] is True


def test_cannot_report_your_own_review(client, world):
    users, _, review_id = world
    assert _report(client, users["beto"][0], "review", review_id).status_code == 400


def test_unknown_or_malformed_review_is_404_or_400(client, world):
    users, _, _ = world
    assert _report(client, users["ana"][0], "review", MISSING).status_code == 404
    assert _report(client, users["ana"][0], "review", "no-es-uuid").status_code == 400


def test_a_hidden_review_cannot_be_reported(client, app, world):
    users, _, review_id = world
    with app.app_context():
        db.session.execute(text("UPDATE place_reviews SET is_hidden = true"))
        db.session.commit()
    assert _report(client, users["ana"][0], "review", review_id).status_code == 404


def test_a_review_of_a_non_public_place_cannot_be_reported(client, app, world):
    users, place_id, review_id = world
    with app.app_context():
        db.session.execute(text("UPDATE places SET is_active = false WHERE id = :p"), {"p": place_id})
        db.session.commit()
    assert _report(client, users["ana"][0], "review", review_id).status_code == 404


def test_a_blocked_author_is_not_reportable(client, world):
    users, _, review_id = world
    ana = users["ana"][0]
    client.post("/api/users/me/blocks", json={"user_id": users["beto"][1]}, headers=auth(ana))
    assert _report(client, ana, "review", review_id).status_code == 404


def test_requires_a_session_and_a_valid_reason(client, world):
    users, _, review_id = world
    assert client.post("/api/reports", json={"target_type": "review", "target_id": review_id, "reason": "spam"}).status_code == 401
    assert _report(client, users["ana"][0], "review", review_id, reason="inventado").status_code == 400


def test_child_safety_reports_on_reviews_are_critical(client, world):
    users, _, review_id = world
    body = _report(client, users["ana"][0], "review", review_id, reason="child_safety").get_json()["report"]
    assert body["priority"] == "critical"


def test_moderators_see_the_review_in_the_queue_with_a_snapshot(client, world):
    users, _, review_id = world
    _report(client, users["ana"][0], "review", review_id)

    reports = _queue(client, users["mod"][0]).get_json()["reports"]

    assert [r["target_type"] for r in reports] == ["review"]
    assert "pastillas" in (reports[0].get("content_snapshot") or reports[0].get("snapshot") or "")


def test_removing_the_content_deletes_the_review_and_closes_the_report(client, app, world):
    users, place_id, review_id = world
    _report(client, users["ana"][0], "review", review_id)
    report_id = _queue(client, users["mod"][0]).get_json()["reports"][0]["id"]

    response = _resolve(client, users["mod"][0], report_id, "remove_content")

    assert response.status_code == 200
    assert response.get_json()["report"]["status"] == "actioned"
    with app.app_context():
        assert db.session.execute(text("SELECT count(*) FROM place_reviews")).scalar() == 0
    # Y el promedio del lugar deja de contarla.
    assert client.get(f"/api/places/{place_id}").get_json()["place"]["reviews_count"] == 0


def test_dismissing_keeps_the_review(client, app, world):
    users, _, review_id = world
    _report(client, users["ana"][0], "review", review_id)
    report_id = _queue(client, users["mod"][0]).get_json()["reports"][0]["id"]

    assert _resolve(client, users["mod"][0], report_id, "dismiss").status_code == 200
    with app.app_context():
        assert db.session.execute(text("SELECT count(*) FROM place_reviews")).scalar() == 1


def test_the_reporter_is_never_revealed_to_the_author(client, world):
    users, _, review_id = world
    _report(client, users["ana"][0], "review", review_id)
    # La reseña de beto no expone nada de reportes.
    own = client.get(f"/api/places/{world[1]}/reviews", headers=auth(users["beto"][0])).get_json()["reviews"][0]
    assert set(own) == {"id", "rating", "body", "created_at", "updated_at", "is_mine", "author", "hidden", "images", "reply"}
