# Horario, cierres y calendario de reservas (ADR-040 fase 9): solo quien gestiona edita; una
# reserva solo entra dentro del horario y en días abiertos; huecos libres con cupo restante;
# zona horaria fija de El Salvador (UTC-6).

from datetime import date, datetime, time, timedelta, timezone

import pytest
from sqlalchemy import text

from app.domain.reservations import schedule
from app.extensions import db
from tests.places.helpers import auth, insert_place, make_users

MISSING = "00000000-0000-4000-8000-000000000000"
LOCAL = schedule.PLACE_TZ


def _local_day(days=3):
    return (datetime.now(timezone.utc).astimezone(LOCAL) + timedelta(days=days)).date()


def _at(day, hour, minute=0):
    return datetime.combine(day, time(hour, minute), tzinfo=LOCAL).astimezone(timezone.utc).isoformat()


def _week(*days):
    return {"days": [{"weekday": d, "intervals": i} for d, i in days]}


def _open_every_day(opens="09:00", closes="17:00"):
    return _week(*[(d, [{"opens": opens, "closes": closes}]) for d in range(7)])


@pytest.fixture()
def world(app, client):
    users = make_users(app, client, with_moderator=True)
    with app.app_context():
        place_id = insert_place("Café Aurora")
        db.session.execute(
            text("INSERT INTO place_managers (place_id, user_id) VALUES (:p, :u)"),
            {"p": place_id, "u": users["ana"][1]},
        )
        db.session.commit()
    client.put(
        f"/api/places/{place_id}/manage/reservations/settings",
        json={"enabled": True, "capacity": 6, "max_party_size": 4},
        headers=auth(users["ana"][0]),
    )
    return users, place_id


def _put_hours(client, token, place_id, body):
    return client.put(f"/api/places/{place_id}/manage/hours", json=body, headers=auth(token))


def _book(client, token, place_id, starts_at, party=2):
    return client.post(
        f"/api/places/{place_id}/reservations", json={"starts_at": starts_at, "party_size": party}, headers=auth(token)
    )


# --- Lógica pura -----------------------------------------------------------------


def test_week_parsing_sorts_and_accepts_closed_days():
    week = schedule.parse_week(
        [{"weekday": 0, "intervals": [{"opens": "17:00", "closes": "21:00"}, {"opens": "09:00", "closes": "13:00"}]},
         {"weekday": 1, "intervals": []}]
    )
    assert week[0] == [(time(9, 0), time(13, 0)), (time(17, 0), time(21, 0))]
    assert week[1] == []


@pytest.mark.parametrize(
    "days",
    [
        "lunes", [1], [{"weekday": 7}], [{"weekday": -1}], [{"weekday": True}], [{"weekday": "0"}],
        [{"weekday": 0}, {"weekday": 0}],
        [{"weekday": 0, "intervals": [{"opens": "9:00", "closes": "13:00"}]}],
        [{"weekday": 0, "intervals": [{"opens": "09:10", "closes": "13:00"}]}],
        [{"weekday": 0, "intervals": [{"opens": "13:00", "closes": "09:00"}]}],
        [{"weekday": 0, "intervals": [{"opens": "09:00", "closes": "09:00"}]}],
        [{"weekday": 0, "intervals": [{"opens": "09:00", "closes": "13:00"}, {"opens": "12:00", "closes": "15:00"}]}],
        [{"weekday": 0, "intervals": [{"opens": "01:00", "closes": "02:00"}] * 4}],
        [{"weekday": 0, "intervals": "todo el día"}],
        [{"weekday": 0, "intervals": [{"opens": "09:00", "closes": "24:00"}]}],
        [{"weekday": d} for d in range(8)],
    ],
)
def test_invalid_weeks_are_rejected(days):
    from app.domain.reservations.exceptions import InvalidReservationDataError

    with pytest.raises(InvalidReservationDataError):
        schedule.parse_week(days)


def test_open_check_uses_local_time_and_excludes_closing_time():
    day = date(2026, 10, 12)  # lunes
    week = {0: [(time(9, 0), time(17, 0))]}

    def moment(hour, minute=0):
        return datetime.combine(day, time(hour, minute), tzinfo=LOCAL)

    assert schedule.is_open_at(week, {}, moment(9)) == (True, None)
    assert schedule.is_open_at(week, {}, moment(16, 45)) == (True, None)
    assert schedule.is_open_at(week, {}, moment(17)) == (False, "outside_hours")
    assert schedule.is_open_at(week, {}, moment(8, 45)) == (False, "outside_hours")
    assert schedule.is_open_at(week, {day: None}, moment(12)) == (False, "closed_day")
    # 09:00 hora local = 15:00 UTC: se interpreta por la hora local, no la UTC.
    assert schedule.is_open_at(week, {}, datetime(2026, 10, 12, 15, 0, tzinfo=timezone.utc)) == (True, None)
    assert schedule.is_open_at({}, {}, moment(3)) == (True, None)  # sin horario cargado


# --- Configuración -------------------------------------------------------------------


def test_only_the_manager_edits_hours_and_closures(client, world):
    users, place_id = world
    day = _local_day().isoformat()
    for token in (users["beto"][0], users["mod"][0]):
        headers = auth(token)
        assert _put_hours(client, token, place_id, _open_every_day()).status_code == 404
        assert client.post(f"/api/places/{place_id}/manage/closures", json={"date": day}, headers=headers).status_code == 404
        assert client.delete(f"/api/places/{place_id}/manage/closures/{day}", headers=headers).status_code == 404
        assert client.get(f"/api/places/{place_id}/manage/calendar", headers=headers).status_code == 404
    assert client.put(f"/api/places/{place_id}/manage/hours", json={}).status_code == 401


def test_set_and_read_hours(client, world):
    users, place_id = world
    response = _put_hours(client, users["ana"][0], place_id, _week(
        (0, [{"opens": "09:00", "closes": "13:00"}, {"opens": "17:00", "closes": "21:00"}]), (6, [])))
    assert response.status_code == 200

    # Cualquier persona con sesión la lee: siete días, los no listados cerrados.
    shown = client.get(f"/api/places/{place_id}/hours", headers=auth(users["beto"][0])).get_json()["schedule"]
    assert shown["timezone"] == "UTC-06:00"
    assert [d["weekday"] for d in shown["days"]] == list(range(7))
    assert shown["days"][0]["intervals"] == [
        {"opens": "09:00", "closes": "13:00"}, {"opens": "17:00", "closes": "21:00"}]
    assert shown["days"][3]["intervals"] == []
    # Reemplaza todo el horario, no lo mezcla.
    _put_hours(client, users["ana"][0], place_id, _week((2, [{"opens": "10:00", "closes": "12:00"}])))
    again = client.get(f"/api/places/{place_id}/hours", headers=auth(users["beto"][0])).get_json()["schedule"]
    assert again["days"][0]["intervals"] == [] and again["days"][2]["intervals"]
    assert client.get(f"/api/places/{MISSING}/hours", headers=auth(users["beto"][0])).status_code == 404
    assert client.get(f"/api/places/{place_id}/hours").status_code == 401


def test_invalid_hours_change_nothing(client, world):
    users, place_id = world
    _put_hours(client, users["ana"][0], place_id, _open_every_day())
    bad = _put_hours(client, users["ana"][0], place_id, _week((0, [{"opens": "13:00", "closes": "09:00"}])))
    assert bad.status_code == 400
    shown = client.get(f"/api/places/{place_id}/hours", headers=auth(users["ana"][0])).get_json()["schedule"]
    assert shown["days"][0]["intervals"] == [{"opens": "09:00", "closes": "17:00"}]


def test_closures_add_replace_and_remove(client, world):
    users, place_id = world
    headers = auth(users["ana"][0])
    day = _local_day(10).isoformat()
    base = f"/api/places/{place_id}/manage/closures"

    assert client.post(base, json={"date": day, "reason": "  Feriado  "}, headers=headers).get_json() == {
        "closure": {"date": day, "reason": "Feriado"}}
    client.post(base, json={"date": day, "reason": "Vacaciones"}, headers=headers)  # repetir reemplaza
    shown = client.get(f"/api/places/{place_id}/hours", headers=headers).get_json()["schedule"]
    assert shown["closures"] == [{"date": day, "reason": "Vacaciones"}]

    assert client.delete(f"{base}/{day}", headers=headers).status_code == 200
    assert client.delete(f"{base}/{day}", headers=headers).status_code == 404
    assert client.delete(f"{base}/no-es-fecha", headers=headers).status_code == 400


@pytest.mark.parametrize(
    "payload",
    [
        {}, {"date": "mañana"}, {"date": "2020-01-01"}, {"date": (date.today() + timedelta(days=400)).isoformat()},
        {"date": 5}, {"date": _local_day().isoformat(), "reason": "x" * 121},
        {"date": _local_day().isoformat(), "reason": 7}, {"date": _local_day().isoformat(), "reason": "a\x00b"},
    ],
)
def test_invalid_closures_are_rejected(client, world, payload):
    users, place_id = world
    response = client.post(f"/api/places/{place_id}/manage/closures", json=payload, headers=auth(users["ana"][0]))
    assert response.status_code == 400


# --- Reservas contra el horario ---------------------------------------------------------


def test_reservation_must_fall_inside_opening_hours(client, world):
    users, place_id = world
    _put_hours(client, users["ana"][0], place_id, _open_every_day("09:00", "17:00"))
    day = _local_day()

    assert _book(client, users["beto"][0], place_id, _at(day, 12)).status_code == 201
    late = _book(client, users["beto"][0], place_id, _at(day, 20))
    assert late.status_code == 409 and late.get_json()["reason"] == "outside_hours"
    assert _book(client, users["beto"][0], place_id, _at(day, 17)).status_code == 409  # justo al cerrar
    assert _book(client, users["beto"][0], place_id, _at(day, 16, 45)).status_code == 201


def test_a_closed_day_blocks_reservations_even_without_hours(client, world):
    users, place_id = world
    day = _local_day()
    client.post(f"/api/places/{place_id}/manage/closures", json={"date": day.isoformat()}, headers=auth(users["ana"][0]))
    response = _book(client, users["beto"][0], place_id, _at(day, 12))
    assert response.status_code == 409 and response.get_json()["reason"] == "closed_day"
    # Otro día sigue libre: sin horario cargado no se restringe por hora.
    assert _book(client, users["beto"][0], place_id, _at(day + timedelta(days=1), 12)).status_code == 201


def test_weekday_with_no_intervals_is_closed(client, world):
    users, place_id = world
    day = _local_day()
    _put_hours(client, users["ana"][0], place_id, _week(*[(d, [{"opens": "09:00", "closes": "17:00"}])
                                                          for d in range(7) if d != day.weekday()]))
    response = _book(client, users["beto"][0], place_id, _at(day, 12))
    assert response.status_code == 409 and response.get_json()["reason"] == "outside_hours"


# --- Disponibilidad ----------------------------------------------------------------------


def test_availability_lists_free_slots_with_seats_left(client, world):
    users, place_id = world
    _put_hours(client, users["ana"][0], place_id, _open_every_day("09:00", "11:00"))
    day = _local_day()
    _book(client, users["beto"][0], place_id, _at(day, 9, 30), party=4)

    body = client.get(f"/api/places/{place_id}/availability?date={day.isoformat()}", headers=auth(users["mod"][0])).get_json()["availability"]
    assert body["accepts_reservations"] is True and body["max_party_size"] == 4
    assert [s["starts_at"] for s in body["slots"]] == [
        _at(day, 9), _at(day, 9, 15), _at(day, 9, 30), _at(day, 9, 45), _at(day, 10), _at(day, 10, 15),
        _at(day, 10, 30), _at(day, 10, 45)]
    seats = {s["starts_at"]: s["seats_left"] for s in body["slots"]}
    assert seats[_at(day, 9, 30)] == 2 and seats[_at(day, 9)] == 6


def test_availability_edge_cases(client, world):
    users, place_id = world
    headers = auth(users["beto"][0])
    day = _local_day()
    url = f"/api/places/{place_id}/availability"
    # Sin horario cargado no hay huecos que ofrecer.
    assert client.get(f"{url}?date={day.isoformat()}", headers=headers).get_json()["availability"]["slots"] == []
    _put_hours(client, users["ana"][0], place_id, _open_every_day())
    client.post(f"/api/places/{place_id}/manage/closures", json={"date": day.isoformat()}, headers=auth(users["ana"][0]))
    assert client.get(f"{url}?date={day.isoformat()}", headers=headers).get_json()["availability"]["slots"] == []
    for bad in ("ayer", "2020-01-01", (date.today() + timedelta(days=200)).isoformat()):
        assert client.get(f"{url}?date={bad}", headers=headers).status_code == 400
    assert client.get(f"/api/places/{MISSING}/availability", headers=headers).status_code == 404
    assert client.get(url).status_code == 401


def test_availability_without_reservations_enabled(client, world):
    users, place_id = world
    client.put(f"/api/places/{place_id}/manage/reservations/settings", json={"enabled": False}, headers=auth(users["ana"][0]))
    body = client.get(f"/api/places/{place_id}/availability", headers=auth(users["beto"][0])).get_json()["availability"]
    assert body["accepts_reservations"] is False and body["slots"] == []


# --- Calendario del negocio ----------------------------------------------------------------


def test_calendar_summarizes_each_day(client, world):
    users, place_id = world
    headers = auth(users["ana"][0])
    _put_hours(client, users["ana"][0], place_id, _open_every_day())
    day = _local_day()
    client.post(f"/api/places/{place_id}/manage/closures", json={"date": (day + timedelta(days=1)).isoformat(), "reason": "Feriado"}, headers=headers)
    first = _book(client, users["beto"][0], place_id, _at(day, 12), party=2).get_json()["reservation"]
    _book(client, users["mod"][0], place_id, _at(day, 13), party=3)
    client.post(f"/api/places/{place_id}/manage/reservations/{first['id']}/confirm", headers=headers)

    result = client.get(f"/api/places/{place_id}/manage/calendar?from={day.isoformat()}&to={(day + timedelta(days=2)).isoformat()}", headers=headers).get_json()
    first_day, second_day, third_day = result["days"]
    assert first_day["reservations"] == {"pending": 1, "confirmed": 1, "people": 5}
    assert first_day["intervals"] == [{"opens": "09:00", "closes": "17:00"}] and first_day["closed"] is False
    assert second_day["closed"] is True and second_day["closure_reason"] == "Feriado"
    assert third_day["reservations"] == {"pending": 0, "confirmed": 0, "people": 0}


def test_a_late_night_reservation_counts_on_its_local_day(client, world):
    """Las 23:00 locales son las 05:00 UTC del día siguiente: se cuenta en el día local."""
    users, place_id = world
    day = _local_day()
    _put_hours(client, users["ana"][0], place_id, _open_every_day("18:00", "23:45"))
    assert _book(client, users["beto"][0], place_id, _at(day, 23)).status_code == 201
    result = client.get(f"/api/places/{place_id}/manage/calendar?from={day.isoformat()}&to={day.isoformat()}", headers=auth(users["ana"][0])).get_json()
    assert result["days"][0]["reservations"]["pending"] == 1


@pytest.mark.parametrize(
    "query",
    ["from=hoy", "to=mañana", "from=2026-10-10&to=2026-10-01", "from=2026-10-01&to=2026-12-01"],
)
def test_calendar_range_validation(client, world, query):
    users, place_id = world
    assert client.get(f"/api/places/{place_id}/manage/calendar?{query}", headers=auth(users["ana"][0])).status_code == 400


def test_rate_limited(client, world, monkeypatch):
    from app.domain.rate_limiting import policy
    from app.domain.rate_limiting.policy import RateLimitRule

    # La fixture `world` ya gastó una escritura (activar reservas): quedan 1 de 2.
    monkeypatch.setattr(policy, "RESERVATION_WRITE", RateLimitRule("reservation_write", 2, 3600, clear_on_success=False))
    users, place_id = world
    assert _put_hours(client, users["ana"][0], place_id, _open_every_day()).status_code == 200
    assert _put_hours(client, users["ana"][0], place_id, _open_every_day()).status_code == 429


def test_hours_and_closures_go_away_with_the_place(client, app, world):
    users, place_id = world
    _put_hours(client, users["ana"][0], place_id, _open_every_day())
    client.post(f"/api/places/{place_id}/manage/closures", json={"date": _local_day().isoformat()}, headers=auth(users["ana"][0]))
    with app.app_context():
        db.session.execute(text("DELETE FROM places WHERE id = :p"), {"p": place_id})
        db.session.commit()
        assert db.session.execute(text("SELECT count(*) FROM place_opening_hours")).scalar() == 0
        assert db.session.execute(text("SELECT count(*) FROM place_closures")).scalar() == 0
