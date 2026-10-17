# Estadísticas del panel de negocio (ADR-040 §31): solo conteos agregados, por día de El Salvador
# (UTC-6), con guardados y planes ocultos por debajo de 5 y sin ningún identificador de persona.

from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from app.domain.analytics import place_analytics as pa
from app.domain.places.exceptions import InvalidPlaceQueryError
from app.extensions import db
from tests.places.helpers import auth, insert_place, make_users
from tests.test_reports import _register_and_login

MISSING = "00000000-0000-4000-8000-000000000000"
TODAY = date(2026, 10, 10)


def _money(cents):
    return {"cents": cents, "amount": f"{cents // 100}.{cents % 100:02d}", "currency": "USD"}


def _empty():
    return {"reviews": [], "saves": [], "plans": [], "posts": [], "reservations": [], "quotes": []}


# --- Lógica pura ----------------------------------------------------------------------


@pytest.mark.parametrize("raw,expected", [(None, 30), ("", 30), ("7", 7), (30, 30), ("90", 90), (" 7 ", 7)])
def test_days_accepts_only_the_closed_list(raw, expected):
    assert pa.parse_days(raw) == expected


@pytest.mark.parametrize("raw", ["0", "1", "8", "31", "365", "-7", "abc", "7.5", True, False, "7;", "٧"])
def test_days_outside_the_list_is_rejected(raw):
    with pytest.raises(InvalidPlaceQueryError):
        pa.parse_days(raw)


def test_local_today_uses_el_salvador_time():
    # 03:00 UTC del día 11 son las 21:00 del día 10 en El Salvador.
    assert pa.local_today(datetime(2026, 10, 11, 3, 0, tzinfo=timezone.utc)) == date(2026, 10, 10)
    assert pa.local_today(datetime(2026, 10, 11, 6, 0, tzinfo=timezone.utc)) == date(2026, 10, 11)
    assert pa.local_today(datetime(2026, 10, 11, 5, 59, tzinfo=timezone.utc)) == date(2026, 10, 10)


def test_period_bounds_are_contiguous_and_equal_in_length():
    for days in pa.DAYS_ALLOWED:
        bounds = pa.period_bounds(TODAY, days)
        (c0, c1), (p0, p1) = bounds["current"], bounds["previous"]
        assert c1 == TODAY and (c1 - c0).days + 1 == days
        assert (p1 - p0).days + 1 == days and p1 + timedelta(days=1) == c0


def test_the_series_has_one_value_per_day_with_zeros():
    report = pa.build_report(_empty(), TODAY, 7, _money)
    assert [p["date"] for p in report["series"]][0] == "2026-10-04" and report["series"][-1]["date"] == "2026-10-10"
    assert len(report["series"]) == 7
    assert all(p["reviews"] == 0 and p["reservations"] == 0 for p in report["series"])
    assert report["totals"]["reservations"]["requested"] == 0
    assert report["totals"]["rating_average"] is None
    assert report["totals"]["quotes"]["accepted_value"]["amount"] == "0.00"


def test_totals_equal_the_sum_of_the_series_and_status_breakdowns():
    data = _empty()
    data["reservations"] = [
        {"day": date(2026, 10, 9), "status": "confirmed", "count": 2, "people": 7},
        {"day": date(2026, 10, 9), "status": "pending", "count": 1, "people": 2},
        {"day": date(2026, 10, 10), "status": "declined", "count": 1, "people": 4},
        {"day": date(2026, 10, 10), "status": "cancelled", "count": 3, "people": 6},
    ]
    data["quotes"] = [
        {"day": date(2026, 10, 8), "status": "accepted", "count": 2, "total_cents": 25000},
        {"day": date(2026, 10, 8), "status": "rejected", "count": 1, "total_cents": 9999},
        {"day": date(2026, 10, 10), "status": "pending", "count": 4, "total_cents": 1},
    ]
    report = pa.build_report(data, TODAY, 7, _money)
    res, quo = report["totals"]["reservations"], report["totals"]["quotes"]
    assert res == {"requested": 7, "confirmed": 2, "declined": 1, "cancelled": 3, "pending": 1, "people_confirmed": 7}
    assert quo["requested"] == 7 and (quo["accepted"], quo["rejected"], quo["pending"]) == (2, 1, 4)
    assert quo["accepted_value"] == {"cents": 25000, "amount": "250.00", "currency": "USD"}
    assert sum(p["reservations"] for p in report["series"]) == res["requested"]
    assert sum(p["quotes"] for p in report["series"]) == quo["requested"]


def test_rows_outside_the_current_period_do_not_count_in_it():
    data = _empty()
    data["reviews"] = [
        {"day": date(2026, 10, 10), "count": 2, "rating_sum": 9},
        {"day": date(2026, 9, 1), "count": 5, "rating_sum": 5},  # anterior
    ]
    report = pa.build_report(data, TODAY, 7, _money)
    assert report["totals"]["reviews"] == 2 and report["previous"]["reviews"] == 0
    assert report["totals"]["rating_average"] == 4.5  # solo las del periodo
    assert report["change"]["reviews"] is None  # el anterior fue 0


def test_the_change_is_a_percentage_and_never_invents_infinity():
    assert pa.change(15, 10) == 50 and pa.change(5, 10) == -50 and pa.change(10, 10) == 0
    assert pa.change(5, 0) is None and pa.change(None, 5) is None and pa.change(5, None) is None
    assert pa.change(0, 4) == -100


def _sensitive(saves_current, saves_previous):
    data = _empty()
    data["saves"] = [{"day": date(2026, 10, 10), "count": saves_current}] if saves_current else []
    data["saves"] += [{"day": date(2026, 9, 28), "count": saves_previous}] if saves_previous else []
    return pa.build_report(data, TODAY, 7, _money)


@pytest.mark.parametrize("count", [0, 1, 4])
def test_few_saves_are_hidden_not_zeroed(count):
    report = _sensitive(count, 0)
    assert "saves" in report["hidden"] and report["totals"]["saves"] is None
    assert all(p["saves"] is None for p in report["series"])
    assert report["change"]["saves"] is None


def test_five_or_more_saves_are_shown():
    report = _sensitive(5, 0)
    assert "saves" not in report["hidden"] and report["totals"]["saves"] == 5
    assert report["series"][-1]["saves"] == 5 and report["series"][0]["saves"] == 0


def test_the_previous_period_is_hidden_on_its_own():
    report = _sensitive(6, 3)
    assert report["totals"]["saves"] == 6 and report["previous"]["saves"] is None
    assert report["change"]["saves"] is None
    assert _sensitive(10, 5)["change"]["saves"] == 100


def test_plans_are_also_sensitive_but_other_metrics_are_never_hidden():
    data = _empty()
    data["plans"] = [{"day": TODAY, "count": 2}]
    data["posts"] = [{"day": TODAY, "count": 1}]
    report = pa.build_report(data, TODAY, 7, _money)
    assert report["hidden"] == ["saves", "plans", "visits"]  # visitas: ADR-040 §33
    assert report["totals"]["posts"] == 1 and report["series"][-1]["posts"] == 1
    assert report["min_count"] == 5


def test_the_report_has_no_person_identifiers():
    data = _empty()
    data["reservations"] = [{"day": TODAY, "status": "confirmed", "count": 1, "people": 2}]
    text_form = repr(pa.build_report(data, TODAY, 30, _money)).lower()
    for forbidden in ("user_id", "username", "email", "name", "uuid"):
        assert forbidden not in text_form


# --- API ------------------------------------------------------------------------------------


def _now_local_day():
    return pa.local_today(datetime.now(timezone.utc))


def _at(local_day, hour=12):
    """Instante UTC que cae en `local_day` a la hora local `hour`."""
    return datetime(local_day.year, local_day.month, local_day.day, hour, tzinfo=timezone.utc) + timedelta(hours=6)


@pytest.fixture()
def world(app, client):
    users = make_users(app, client, with_moderator=True)  # ana gestiona; beto y mod no
    with app.app_context():
        place_id = insert_place("Café Aurora")
        other_id = insert_place("Otro lugar")
        db.session.execute(
            text("INSERT INTO place_managers (place_id, user_id) VALUES (:p, :u)"),
            {"p": place_id, "u": users["ana"][1]},
        )
        db.session.commit()
    return users, place_id, other_id


def _get(client, token, place_id, query=""):
    return client.get(f"/api/places/{place_id}/manage/analytics{query}", headers=auth(token))


def _insert(app, sql, **params):
    with app.app_context():
        db.session.execute(text(sql), params)
        db.session.commit()


def test_only_the_manager_sees_the_analytics(client, world):
    users, place_id, _ = world
    assert _get(client, users["ana"][0], place_id).status_code == 200
    for who in ("beto", "mod"):
        assert _get(client, users[who][0], place_id).status_code == 404, who
    assert _get(client, users["ana"][0], MISSING).status_code == 404
    assert client.get(f"/api/places/{place_id}/manage/analytics").status_code == 401


@pytest.mark.parametrize("query", ["?days=0", "?days=8", "?days=abc", "?days=365", "?days=-7", "?days=7.5"])
def test_invalid_days_are_a_400(client, world, query):
    users, place_id, _ = world
    assert _get(client, users["ana"][0], place_id, query).status_code == 400


@pytest.mark.parametrize("days", [7, 30, 90])
def test_an_empty_place_returns_a_full_series_of_zeros(client, world, days):
    users, place_id, _ = world
    response = _get(client, users["ana"][0], place_id, f"?days={days}")
    assert response.headers["Cache-Control"] == "no-store"
    report = response.get_json()["analytics"]
    assert len(report["series"]) == days and report["range"]["days"] == days
    assert report["range"]["to"] == _now_local_day().isoformat()
    assert report["hidden"] == ["saves", "plans", "visits"]  # visitas: ADR-040 §33
    assert report["totals"]["reservations"]["requested"] == 0 and report["totals"]["rating_average"] is None


def test_each_day_counts_what_happened_that_local_day(app, client, world):
    users, place_id, _ = world
    today = _now_local_day()
    yesterday = today - timedelta(days=1)
    for when, party in ((_at(today), 2), (_at(today, 1), 3), (_at(yesterday), 4)):
        _insert(app, "INSERT INTO place_reservations (place_id, user_id, starts_at, party_size, status, created_at) "
                     "VALUES (:p, :u, now() + interval '3 days', :n, 'confirmed', :c)",
                p=place_id, u=users["beto"][1], n=party, c=when)
    series = _get(client, users["ana"][0], place_id, "?days=7").get_json()["analytics"]["series"]
    by_date = {p["date"]: p for p in series}
    assert by_date[today.isoformat()]["reservations"] == 2
    assert by_date[yesterday.isoformat()]["reservations"] == 1


def test_the_local_midnight_boundary_is_respected(app, client, world):
    users, place_id, _ = world
    today = _now_local_day()
    # 23:59 locales de ayer = 05:59 UTC de hoy; 00:00 locales de hoy = 06:00 UTC de hoy.
    just_before = datetime(today.year, today.month, today.day, 5, 59, tzinfo=timezone.utc)
    just_after = datetime(today.year, today.month, today.day, 6, 0, tzinfo=timezone.utc)
    for when in (just_before, just_after):
        _insert(app, "INSERT INTO place_quotes (place_id, user_id, total_cents, valid_until, created_at) "
                     "VALUES (:p, :u, 100, now() + interval '7 days', :c)", p=place_id, u=users["beto"][1], c=when)
    by_date = {p["date"]: p for p in _get(client, users["ana"][0], place_id, "?days=7").get_json()["analytics"]["series"]}
    assert by_date[(today - timedelta(days=1)).isoformat()]["quotes"] == 1
    assert by_date[today.isoformat()]["quotes"] == 1


def test_statuses_values_and_people_are_aggregated(app, client, world):
    users, place_id, _ = world
    today = _now_local_day()
    for status, party in (("confirmed", 4), ("confirmed", 3), ("declined", 2), ("pending", 1)):
        _insert(app, "INSERT INTO place_reservations (place_id, user_id, starts_at, party_size, status, created_at) "
                     "VALUES (:p, :u, now() + interval '3 days', :n, :s, :c)",
                p=place_id, u=users["beto"][1], n=party, s=status, c=_at(today))
    for status, cents in (("accepted", 12500), ("accepted", 2500), ("rejected", 9000), ("pending", 100)):
        extra = ", decided_at" if status != "pending" else ""
        values = ", now()" if status != "pending" else ""
        _insert(app, f"INSERT INTO place_quotes (place_id, user_id, total_cents, valid_until, status, created_at{extra}) "
                     f"VALUES (:p, :u, :t, now() + interval '7 days', :s, :c{values})",
                p=place_id, u=users["beto"][1], t=cents, s=status, c=_at(today))
    totals = _get(client, users["ana"][0], place_id).get_json()["analytics"]["totals"]
    assert totals["reservations"] == {"requested": 4, "confirmed": 2, "declined": 1, "cancelled": 0,
                                      "pending": 1, "people_confirmed": 7}
    assert totals["quotes"]["accepted"] == 2 and totals["quotes"]["accepted_value"]["amount"] == "150.00"
    assert totals["quotes"]["requested"] == 4 and totals["quotes"]["rejected"] == 1


def test_hidden_reviews_and_other_places_do_not_count(app, client, world):
    users, place_id, other_id = world
    today = _now_local_day()
    _insert(app, "INSERT INTO place_reviews (place_id, user_id, rating, body, is_hidden, created_at) "
                 "VALUES (:p, :u, 5, 'a', false, :c), (:p, :m, 1, 'b', true, :c), (:o, :u, 3, 'c', false, :c)",
            p=place_id, o=other_id, u=users["beto"][1], m=users["mod"][1], c=_at(today))
    report = _get(client, users["ana"][0], place_id).get_json()["analytics"]
    assert report["totals"]["reviews"] == 1 and report["totals"]["rating_average"] == 5.0


def test_saves_are_hidden_below_five_and_shown_from_five(app, client, world, monkeypatch):
    from app.domain.rate_limiting import policy
    from app.domain.rate_limiting.policy import RateLimitRule

    # Registrar personas de relleno desde la misma IP toparía con el límite de altas.
    monkeypatch.setattr(policy, "REGISTER", RateLimitRule("register", 1000, 3600, False))
    users, place_id, _ = world
    today = _now_local_day()
    with app.app_context():
        ids = [users["ana"][1], users["beto"][1], users["mod"][1]]
    for user_id in ids:
        _insert(app, "INSERT INTO saved_places (user_id, place_id, created_at) VALUES (:u, :p, :c)",
                u=user_id, p=place_id, c=_at(today))
    hidden = _get(client, users["ana"][0], place_id).get_json()["analytics"]
    assert "saves" in hidden["hidden"] and hidden["totals"]["saves"] is None
    assert all(point["saves"] is None for point in hidden["series"])
    for i in range(3):  # personas de relleno hasta pasar de 5
        extra = _register_and_login(client, f"relleno{i}")
        _insert(app, "INSERT INTO saved_places (user_id, place_id, created_at) VALUES (:u, :p, :c)",
                u=extra[1], p=place_id, c=_at(today))
    shown = _get(client, users["ana"][0], place_id).get_json()["analytics"]
    assert "saves" not in shown["hidden"] and shown["totals"]["saves"] == 6
    assert shown["series"][-1]["saves"] == 6


def test_the_previous_period_comparison_is_computed(app, client, world):
    users, place_id, _ = world
    today = _now_local_day()
    for offset, n in ((1, 3), (10, 2)):  # 3 en el periodo actual de 7 días, 2 en el anterior
        for _ in range(n):
            _insert(app, "INSERT INTO place_quotes (place_id, user_id, total_cents, valid_until, created_at) "
                         "VALUES (:p, :u, 1, now() + interval '7 days', :c)",
                    p=place_id, u=users["beto"][1], c=_at(today - timedelta(days=offset)))
    report = _get(client, users["ana"][0], place_id, "?days=7").get_json()["analytics"]
    assert report["totals"]["quotes"]["requested"] == 3 and report["previous"]["quotes"] == 2
    assert report["change"]["quotes"] == 50


def test_the_response_has_no_person_identifiers(app, client, world):
    users, place_id, _ = world
    today = _now_local_day()
    _insert(app, "INSERT INTO place_reservations (place_id, user_id, starts_at, party_size, status, created_at, note) "
                 "VALUES (:p, :u, now() + interval '3 days', 2, 'confirmed', :c, 'NOTA-PRIVADA')",
            p=place_id, u=users["beto"][1], c=_at(today))
    body = _get(client, users["ana"][0], place_id).get_data(as_text=True)
    assert users["beto"][1] not in body and "NOTA-PRIVADA" not in body
    assert "beto" not in body.lower() and "@" not in body


def test_it_is_rate_limited_per_account(client, world, monkeypatch):
    from app.domain.rate_limiting import policy
    from app.domain.rate_limiting.policy import RateLimitRule

    users, place_id, _ = world
    monkeypatch.setattr(policy, "BUSINESS_ANALYTICS", RateLimitRule("business_analytics", 2, 3600, False))
    assert _get(client, users["ana"][0], place_id).status_code == 200
    assert _get(client, users["ana"][0], place_id).status_code == 200
    assert _get(client, users["ana"][0], place_id).status_code == 429
