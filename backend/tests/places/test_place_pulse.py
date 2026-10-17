# Pulse de un lugar (ADR-040 §32): un nivel cualitativo de los últimos 7 días, público, sin cifras
# ni identificadores, y vacío por debajo de 5 eventos.

import pytest
from sqlalchemy import text

from app.domain.pulse import place_pulse as pp
from app.extensions import db
from tests.places.helpers import insert_place, make_users

MISSING = "00000000-0000-4000-8000-000000000000"


# --- Lógica pura ----------------------------------------------------------------------


@pytest.mark.parametrize(
    "total,level",
    [(0, None), (4, None), (5, "moving"), (14, "moving"), (15, "active"), (39, "active"), (40, "buzzing"), (500, "buzzing")],
)
def test_level_thresholds(total, level):
    assert pp.level_for(total) == level


def test_the_total_sums_every_source_and_ignores_garbage():
    assert pp.build_pulse({"reviews": 2, "saves": 2, "plans": 1, "posts": 0})["level"] == "moving"
    assert pp.build_pulse({"reviews": 4})["level"] is None
    assert pp.build_pulse({"reviews": -50, "saves": 5})["level"] == "moving"
    assert pp.build_pulse({"reviews": None, "saves": "6"})["level"] == "moving"


def test_the_pulse_has_no_counts_and_no_breakdown():
    result = pp.build_pulse({"reviews": 30, "saves": 30})
    assert set(result) == {"level", "window_days"} and result["window_days"] == 7


# --- API ------------------------------------------------------------------------------------


@pytest.fixture()
def world(app, client):
    users = make_users(app, client)
    with app.app_context():
        place_id = insert_place("Café Aurora")
        other_id = insert_place("Otro lugar")
        hidden_id = insert_place("Lugar oculto", status="pending")
    return users, place_id, other_id, hidden_id


def _run(app, sql, **params):
    with app.app_context():
        db.session.execute(text(sql), params)
        db.session.commit()


def _pulse(client, place_id):
    return client.get(f"/api/places/{place_id}/pulse")


_fill = {"n": 0}


def _reviews(app, place_id, n, age="0 days", hidden=False):
    """`n` reseñas de personas de relleno (una reseña por persona y lugar)."""
    for _i in range(n):
        _fill["n"] += 1
        with app.app_context():
            uid = db.session.execute(
                text("INSERT INTO users (name, email, password_hash, username) "
                     "VALUES ('Relleno', :e, 'x', :u) RETURNING id"),
                {"e": f"relleno{_fill['n']}@t.test", "u": f"relleno{_fill['n']}"},
            ).scalar()
            db.session.execute(
                text("INSERT INTO place_reviews (place_id, user_id, rating, body, is_hidden, created_at) "
                     "VALUES (:p, :u, 4, 'ok', :h, now() - cast(:age as interval))"),
                {"p": place_id, "u": uid, "h": hidden, "age": age},
            )
            db.session.commit()


def test_public_without_session_and_no_store_of_private_data(client, world):
    _, place_id, _, _ = world
    response = _pulse(client, place_id)
    assert response.status_code == 200
    assert response.get_json() == {"pulse": {"level": None, "window_days": 7}}
    assert "max-age" in response.headers["Cache-Control"]


def test_missing_or_unlisted_place_is_the_same_404(client, world):
    _, _, _, hidden_id = world
    for pid in (MISSING, hidden_id):
        assert _pulse(client, pid).status_code == 404
    assert client.get("/api/places/not-a-uuid/pulse").status_code == 404


def test_the_level_follows_recent_activity(app, client, world):
    users, place_id, other_id, _ = world
    saves = [users["ana"][1], users["beto"][1]]
    for uid in saves:
        _run(app, "INSERT INTO saved_places (user_id, place_id) VALUES (:u, :p)", u=uid, p=place_id)
    assert _pulse(client, place_id).get_json()["pulse"]["level"] is None  # 2 < 5
    _reviews(app, place_id, 3)
    assert _pulse(client, place_id).get_json()["pulse"]["level"] == "moving"  # 5
    assert _pulse(client, other_id).get_json()["pulse"]["level"] is None  # aislado por lugar


def test_old_hidden_and_private_activity_does_not_count(app, client, world):
    users, place_id, _, _ = world
    _reviews(app, place_id, 5, age="30 days")  # fuera de la ventana
    _reviews(app, place_id, 5, hidden=True)  # ocultas por moderación
    _run(app, "UPDATE users SET is_private = true WHERE id = :u", u=users["ana"][1])
    for _i in range(5):
        _run(app, "INSERT INTO posts (author_id, content, place_id) VALUES (:u, 'hola', :p)", u=users["ana"][1], p=place_id)
    assert _pulse(client, place_id).get_json()["pulse"]["level"] is None
    _run(app, "UPDATE users SET is_private = false WHERE id = :u", u=users["ana"][1])
    assert _pulse(client, place_id).get_json()["pulse"]["level"] == "moving"  # 5 publicaciones públicas


def test_cancelled_plans_do_not_count(app, client, world):
    users, place_id, _, _ = world
    for status, n in (("cancelled", 5), ("active", 5)):
        for _i in range(n):
            _run(app, "INSERT INTO place_plans (place_id, creator_id, title, starts_at, status) "
                      "VALUES (:p, :u, 'Plan', now() + interval '2 days', :s)", p=place_id, u=users["ana"][1], s=status)
        level = _pulse(client, place_id).get_json()["pulse"]["level"]
        assert level == (None if status == "cancelled" else "moving")
