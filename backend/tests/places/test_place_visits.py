# Visitas anónimas a la ficha (ADR-040 §33): un contador por lugar, día local y evento; sin
# identificar a nadie; sin contar a quien gestiona el lugar; visibles solo con 5 o más.

from datetime import date, timedelta

import pytest
from sqlalchemy import text

from app.domain.analytics import place_analytics as pa
from app.domain.places.exceptions import InvalidPlaceDataError
from app.domain.visits import place_visits as pv
from app.extensions import db
from tests.places.helpers import auth, insert_place, make_users

MISSING = "00000000-0000-4000-8000-000000000000"
TODAY = date(2026, 10, 10)


def _money(cents):
    return {"cents": cents, "amount": str(cents), "currency": "USD"}


def _data(**extra):
    base = {"reviews": [], "saves": [], "plans": [], "posts": [], "reservations": [], "quotes": [], "visits": []}
    base.update(extra)
    return base


def _v(day, event, count):
    return {"day": day, "event": event, "count": count}


# --- Lógica pura ----------------------------------------------------------------------


@pytest.mark.parametrize("raw", ["view", "phone", "website", "directions", " VIEW ", "Phone"])
def test_known_events_are_accepted(raw):
    assert pv.parse_event(raw) in pv.EVENTS


@pytest.mark.parametrize("raw", [None, "", "click", "views", 1, True, [], {}, "view; drop table"])
def test_unknown_events_are_rejected(raw):
    with pytest.raises(InvalidPlaceDataError):
        pv.parse_event(raw)


def test_the_analytics_event_list_matches_the_domain_list():
    assert pa.VISIT_EVENTS == pv.EVENTS


def test_few_visits_are_hidden_not_zeroed():
    report = pa.build_report(_data(visits=[_v(TODAY, "view", 4)]), TODAY, 7, _money)
    assert "visits" in report["hidden"] and report["totals"]["visits"] is None
    assert all(point["views"] is None for point in report["series"])
    assert report["change"]["views"] is None and report["previous"]["views"] is None


def test_five_visits_in_any_mix_are_shown():
    report = pa.build_report(
        _data(visits=[_v(TODAY, "view", 2), _v(TODAY, "phone", 2), _v(TODAY, "website", 1)]), TODAY, 7, _money
    )
    assert "visits" not in report["hidden"]
    assert report["totals"]["visits"] == {
        "views": 2, "phone": 2, "website": 1, "directions": 0, "conversion_percent": 0.0,
    }
    assert report["series"][-1]["views"] == 2 and report["series"][0]["views"] == 0


def test_conversion_is_requests_over_views():
    data = _data(
        visits=[_v(TODAY, "view", 40)],
        reservations=[{"day": TODAY, "status": "pending", "count": 3, "people": 6}],
        quotes=[{"day": TODAY, "status": "pending", "count": 1, "total_cents": 100}],
    )
    assert pa.build_report(data, TODAY, 7, _money)["totals"]["visits"]["conversion_percent"] == 10.0


def test_conversion_is_not_invented_when_there_are_more_requests_than_views():
    data = _data(
        visits=[_v(TODAY, "phone", 9), _v(TODAY, "view", 2)],
        reservations=[{"day": TODAY, "status": "pending", "count": 3, "people": 6}],
    )
    assert pa.build_report(data, TODAY, 7, _money)["totals"]["visits"]["conversion_percent"] is None


def test_conversion_is_none_without_views():
    report = pa.build_report(_data(visits=[_v(TODAY, "phone", 6)]), TODAY, 7, _money)
    assert report["totals"]["visits"]["conversion_percent"] is None


def test_views_are_compared_with_the_previous_period():
    previous_day = TODAY - timedelta(days=7)
    report = pa.build_report(
        _data(visits=[_v(TODAY, "view", 30), _v(previous_day, "view", 20)]), TODAY, 7, _money
    )
    assert report["previous"]["views"] == 20 and report["change"]["views"] == 50


def test_old_data_without_the_visits_key_still_builds():
    data = _data()
    del data["visits"]
    assert pa.build_report(data, TODAY, 7, _money)["totals"]["visits"] is None


# --- API ------------------------------------------------------------------------------------


@pytest.fixture()
def world(app, client):
    users = make_users(app, client)  # ana gestiona; beto no
    with app.app_context():
        place_id = insert_place("Café Aurora")
        other_id = insert_place("Otro lugar")
        hidden_id = insert_place("Lugar oculto", status="pending")
        db.session.execute(
            text("INSERT INTO place_managers (place_id, user_id) VALUES (:p, :u)"),
            {"p": place_id, "u": users["ana"][1]},
        )
        db.session.commit()
    return users, place_id, other_id, hidden_id


def _post(client, place_id, event="view", token=None, body=None, ip=None):
    headers = auth(token) if token else {}
    if ip:
        headers["X-Forwarded-For"] = ip
    return client.post(
        f"/api/places/{place_id}/visits", json={"event": event} if body is None else body, headers=headers
    )


def _rows(app, place_id):
    with app.app_context():
        return [
            dict(r)
            for r in db.session.execute(
                text("SELECT event, count FROM place_visit_counts WHERE place_id = :p ORDER BY event"),
                {"p": place_id},
            ).mappings()
        ]


def test_an_anonymous_visit_is_counted_with_no_body(app, client, world):
    _, place_id, _, _ = world
    response = _post(client, place_id)
    assert response.status_code == 204 and response.data == b""
    assert _rows(app, place_id) == [{"event": "view", "count": 1}]


def test_visits_accumulate_per_event_in_a_single_row(app, client, world):
    _, place_id, _, _ = world
    for event in ("view", "view", "phone", "directions", "view"):
        assert _post(client, place_id, event).status_code == 204
    assert _rows(app, place_id) == [
        {"event": "directions", "count": 1}, {"event": "phone", "count": 1}, {"event": "view", "count": 3},
    ]


def test_a_logged_in_visitor_is_counted_too_and_nothing_identifies_them(app, client, world):
    users, place_id, _, _ = world
    assert _post(client, place_id, token=users["beto"][0]).status_code == 204
    assert _rows(app, place_id) == [{"event": "view", "count": 1}]
    with app.app_context():
        columns = {
            r[0]
            for r in db.session.execute(
                text("SELECT column_name FROM information_schema.columns WHERE table_name = 'place_visit_counts'")
            )
        }
    assert columns == {"place_id", "day", "event", "count"}  # sin user_id, IP ni hora exacta


def test_the_manager_visits_are_not_counted_and_the_answer_does_not_say_so(app, client, world):
    users, place_id, _, _ = world
    response = _post(client, place_id, token=users["ana"][0])
    assert response.status_code == 204 and response.data == b""
    assert _rows(app, place_id) == []


def test_an_invalid_token_is_just_an_anonymous_visit(app, client, world):
    _, place_id, _, _ = world
    assert _post(client, place_id, token="no.es.un.token").status_code == 204
    assert _rows(app, place_id) == [{"event": "view", "count": 1}]


@pytest.mark.parametrize("body", [{"event": "click"}, {"event": ""}, {"event": 5}, {}, {"evento": "view"}])
def test_an_invalid_event_is_a_400_and_counts_nothing(app, client, world, body):
    _, place_id, _, _ = world
    assert _post(client, place_id, body=body).status_code == 400
    assert _rows(app, place_id) == []


def test_a_missing_or_non_json_body_is_a_400(client, world):
    _, place_id, _, _ = world
    assert client.post(f"/api/places/{place_id}/visits").status_code == 400
    assert client.post(f"/api/places/{place_id}/visits", data="view", content_type="text/plain").status_code == 400
    assert client.post(f"/api/places/{place_id}/visits", json=["view"]).status_code == 400


def test_missing_or_unlisted_place_is_the_same_404_and_counts_nothing(app, client, world):
    _, _, _, hidden_id = world
    for pid in (MISSING, hidden_id):
        assert _post(client, pid).status_code == 404
    assert client.post("/api/places/not-a-uuid/visits", json={"event": "view"}).status_code == 404
    with app.app_context():
        assert db.session.execute(text("SELECT count(*) FROM place_visit_counts")).scalar() == 0


def test_the_counter_is_per_place(app, client, world):
    _, place_id, other_id, _ = world
    _post(client, place_id)
    assert _rows(app, other_id) == []


def test_a_script_cannot_inflate_the_numbers_from_one_address(app, client, world):
    _, place_id, other_id, _ = world
    statuses = [_post(client, place_id, ip="203.0.113.7").status_code for _ in range(32)]
    assert statuses.count(204) == 30 and statuses[-1] == 429
    assert _rows(app, place_id) == [{"event": "view", "count": 30}]
    # el tope es por lugar: el mismo script sigue pudiendo abrir otro lugar normalmente
    assert _post(client, other_id, ip="203.0.113.7").status_code == 204


def test_deleting_the_place_deletes_its_counters(app, client, world):
    _, place_id, _, _ = world
    _post(client, place_id)
    with app.app_context():
        db.session.execute(text("DELETE FROM places WHERE id = :p"), {"p": place_id})
        db.session.commit()
        assert db.session.execute(text("SELECT count(*) FROM place_visit_counts")).scalar() == 0


# --- En las estadísticas del negocio ------------------------------------------------------


def _analytics(client, token, place_id, query=""):
    return client.get(f"/api/places/{place_id}/manage/analytics{query}", headers=auth(token))


def _seed_counts(app, place_id, rows):
    with app.app_context():
        for day, event, count in rows:
            db.session.execute(
                text("INSERT INTO place_visit_counts (place_id, day, event, count) VALUES (:p, :d, :e, :c)"),
                {"p": place_id, "d": day, "e": event, "c": count},
            )
        db.session.commit()


def test_visits_below_five_are_hidden_in_the_manager_panel(app, client, world):
    users, place_id, _, _ = world
    for _i in range(4):
        _post(client, place_id)
    report = _analytics(client, users["ana"][0], place_id).get_json()["analytics"]
    assert "visits" in report["hidden"] and report["totals"]["visits"] is None
    assert all(point["views"] is None for point in report["series"])


def test_visits_from_five_are_shown_with_a_conversion(app, client, world):
    users, place_id, _, _ = world
    for event in ("view",) * 8 + ("phone", "website"):
        _post(client, place_id, event)
    report = _analytics(client, users["ana"][0], place_id, "?days=7").get_json()["analytics"]
    assert "visits" not in report["hidden"]
    visits = report["totals"]["visits"]
    assert (visits["views"], visits["phone"], visits["website"], visits["directions"]) == (8, 1, 1, 0)
    assert visits["conversion_percent"] == 0.0
    assert sum(point["views"] for point in report["series"]) == 8


def test_the_local_day_decides_where_a_visit_falls(app, client, world):
    users, place_id, _, _ = world
    today = pa.local_today(__import__("datetime").datetime.now(__import__("datetime").timezone.utc))
    _seed_counts(
        app, place_id,
        [(today, "view", 6), (today - timedelta(days=1), "view", 3), (today - timedelta(days=40), "view", 9)],
    )
    by_date = {
        p["date"]: p["views"]
        for p in _analytics(client, users["ana"][0], place_id, "?days=7").get_json()["analytics"]["series"]
    }
    assert by_date[today.isoformat()] == 6 and by_date[(today - timedelta(days=1)).isoformat()] == 3
    # 40 días atrás cae fuera de 7 días, pero dentro de 90
    total_90 = _analytics(client, users["ana"][0], place_id, "?days=90").get_json()["analytics"]["totals"]
    assert total_90["visits"]["views"] == 18


def test_other_places_visits_do_not_leak_into_the_panel(app, client, world):
    users, place_id, other_id, _ = world
    for _i in range(10):
        _post(client, other_id)
    report = _analytics(client, users["ana"][0], place_id).get_json()["analytics"]
    assert report["totals"]["visits"] is None


def test_the_panel_response_has_no_person_identifier_for_visits(app, client, world):
    users, place_id, _, _ = world
    for _i in range(6):
        _post(client, place_id, token=users["beto"][0])
    body = _analytics(client, users["ana"][0], place_id).get_data(as_text=True)
    assert users["beto"][1] not in body
