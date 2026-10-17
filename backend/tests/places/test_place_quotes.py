# Cotizador (ADR-040 fase 10): catálogo editado solo por quien gestiona; el total lo calcula
# SIEMPRE el servidor con enteros y los precios vigentes; la cotización guarda una copia de cada
# línea; la ven quien la pidió y quien gestiona el lugar.

import pytest
from sqlalchemy import text

from app.domain.quotes import quotes
from app.extensions import db
from tests.places.helpers import auth, insert_place, make_users

MISSING = "00000000-0000-4000-8000-000000000000"


def _scalar(app, sql, **params):
    with app.app_context():
        return db.session.execute(text(sql), params).scalar()


def _item(client, token, place_id, **overrides):
    body = {"name": "Mesa para cenar", "unit": "person", "unit_price_cents": 1250, **overrides}
    return client.post(f"/api/places/{place_id}/manage/quote-items", json=body, headers=auth(token))


def _quote(client, token, place_id, lines, **extra):
    return client.post(f"/api/places/{place_id}/quotes", json={"lines": lines, **extra}, headers=auth(token))


@pytest.fixture()
def world(app, client):
    users = make_users(app, client, with_moderator=True)  # ana gestiona; beto y mod no
    with app.app_context():
        place_id = insert_place("Café Aurora")
        db.session.execute(
            text("INSERT INTO place_managers (place_id, user_id) VALUES (:p, :u)"),
            {"p": place_id, "u": users["ana"][1]},
        )
        db.session.commit()
    return users, place_id


@pytest.fixture()
def catalog(client, world):
    users, place_id = world
    cena = _item(client, users["ana"][0], place_id).get_json()["item"]
    sala = _item(client, users["ana"][0], place_id, name="Salón privado", unit="hour", unit_price_cents=8000).get_json()["item"]
    return users, place_id, cena, sala


# --- Cálculo puro --------------------------------------------------------------------


def test_compute_uses_exact_integer_cents():
    items = {
        "a": {"id": "a", "name": "A", "unit": "unit", "unit_price_cents": 1},
        "b": {"id": "b", "name": "B", "unit": "person", "unit_price_cents": 1999},
    }
    lines, total = quotes.compute(items, [("a", 3), ("b", 7)])
    assert [line["line_total_cents"] for line in lines] == [3, 13993]
    assert total == 13996 and isinstance(total, int)
    # 0,1 + 0,2 en coma flotante daría 0,30000000000000004; en centavos enteros es exacto.
    assert quotes.compute({"c": {"id": "c", "name": "C", "unit": "unit", "unit_price_cents": 10}}, [("c", 3)])[1] == 30


@pytest.mark.parametrize("cents,text_", [(0, "0.00"), (5, "0.05"), (100, "1.00"), (1250, "12.50"), (100000000, "1000000.00")])
def test_money_formatting_never_uses_floats(cents, text_):
    assert quotes.format_money(cents) == text_


@pytest.mark.parametrize(
    "lines",
    [
        None, [], "uno", [1], [{"item_id": MISSING}], [{"quantity": 1}], [{"item_id": 5, "quantity": 1}],
        [{"item_id": "no-uuid", "quantity": 1}], [{"item_id": MISSING, "quantity": 0}],
        [{"item_id": MISSING, "quantity": -1}], [{"item_id": MISSING, "quantity": 10001}],
        [{"item_id": MISSING, "quantity": "2"}], [{"item_id": MISSING, "quantity": 1.5}],
        [{"item_id": MISSING, "quantity": True}],
        [{"item_id": MISSING, "quantity": 1}, {"item_id": MISSING, "quantity": 2}],
        [{"item_id": f"00000000-0000-4000-8000-{i:012d}", "quantity": 1} for i in range(21)],
    ],
)
def test_invalid_lines_are_rejected(lines):
    with pytest.raises(quotes.InvalidQuoteDataError):
        quotes.parse_lines(lines)


# --- Catálogo --------------------------------------------------------------------------


def test_only_the_manager_edits_the_catalog(client, world):
    users, place_id = world
    base = f"/api/places/{place_id}/manage/quote-items"
    for token in (users["beto"][0], users["mod"][0]):
        assert _item(client, token, place_id).status_code == 404
        assert client.get(base, headers=auth(token)).status_code == 404
        assert client.get(f"/api/places/{place_id}/manage/quotes", headers=auth(token)).status_code == 404
    assert client.get(base).status_code == 401
    assert client.post(base, json={}).status_code == 401


def test_manager_creates_lists_edits_and_deletes_items(client, world):
    users, place_id = world
    headers = auth(users["ana"][0])
    created = _item(client, users["ana"][0], place_id, description="  Menú de 3 tiempos  ")
    assert created.status_code == 201
    item = created.get_json()["item"]
    assert item["unit_price"] == {"cents": 1250, "amount": "12.50", "currency": "USD"}
    assert item["description"] == "Menú de 3 tiempos" and item["is_active"] is True

    url = f"/api/places/{place_id}/manage/quote-items/{item['id']}"
    edited = client.patch(url, json={"unit_price_cents": 1500, "is_active": False}, headers=headers).get_json()["item"]
    assert edited["unit_price"]["amount"] == "15.00" and edited["is_active"] is False
    # Un artículo inactivo no aparece para el público, sí para el negocio.
    assert client.get(f"/api/places/{place_id}/quote-items", headers=auth(users["beto"][0])).get_json() == {"items": []}
    assert len(client.get(f"/api/places/{place_id}/manage/quote-items", headers=headers).get_json()["items"]) == 1

    assert client.delete(url, headers=headers).status_code == 200
    assert client.delete(url, headers=headers).status_code == 404
    assert client.patch(url, json={"name": "x"}, headers=headers).status_code == 404


@pytest.mark.parametrize(
    "overrides",
    [
        {"name": ""}, {"name": "x" * 121}, {"name": "a\nb"}, {"name": 5}, {"unit": "kilo"}, {"unit": None},
        {"unit_price_cents": -1}, {"unit_price_cents": 100000001}, {"unit_price_cents": 12.5},
        {"unit_price_cents": "1250"}, {"unit_price_cents": True}, {"unit_price_cents": None},
        {"description": "x" * 301}, {"description": 7},
    ],
)
def test_invalid_items_are_rejected(client, app, world, overrides):
    users, place_id = world
    assert _item(client, users["ana"][0], place_id, **overrides).status_code == 400
    assert _scalar(app, "SELECT count(*) FROM place_quote_items") == 0


def test_item_names_are_unique_per_place_and_limited(client, app, world, monkeypatch):
    users, place_id = world
    assert _item(client, users["ana"][0], place_id).status_code == 201
    assert _item(client, users["ana"][0], place_id).status_code == 409
    monkeypatch.setattr(quotes, "MAX_ACTIVE_ITEMS_PER_PLACE", 2)
    assert _item(client, users["ana"][0], place_id, name="Otro").status_code == 201
    assert _item(client, users["ana"][0], place_id, name="Tercero").status_code == 409


def test_patch_validation(client, catalog):
    users, place_id, cena, _ = catalog
    url = f"/api/places/{place_id}/manage/quote-items/{cena['id']}"
    headers = auth(users["ana"][0])
    for body in ({}, {"unit_price_cents": 1.5}, {"is_active": "si"}, {"unit": "x"}, {"name": "Salón privado"}):
        assert client.patch(url, json=body, headers=headers).status_code in (400, 409)
    assert client.patch(url, json={"name": "Salón privado"}, headers=headers).status_code == 409


# --- Cotizar -------------------------------------------------------------------------------


def test_quote_total_is_computed_by_the_server(client, catalog):
    users, place_id, cena, sala = catalog
    response = _quote(client, users["beto"][0], place_id,
                      [{"item_id": cena["id"], "quantity": 4}, {"item_id": sala["id"], "quantity": 3}], note=" Cumpleaños ")

    assert response.status_code == 201
    quote = response.get_json()["quote"]
    assert quote["total"] == {"cents": 4 * 1250 + 3 * 8000, "amount": "290.00", "currency": "USD"}
    assert [line["line_total"]["cents"] for line in quote["lines"]] == [5000, 24000]
    assert quote["note"] == "Cumpleaños" and quote["place"]["name"] == "Café Aurora"
    assert quote["valid_until"] > quote["created_at"]


def test_the_client_cannot_inject_prices_or_totals(client, catalog):
    users, place_id, cena, _ = catalog
    response = _quote(
        client, users["beto"][0], place_id,
        [{"item_id": cena["id"], "quantity": 2, "unit_price_cents": 1, "line_total_cents": 1, "price": 0}],
        total_cents=1, total=0, user_id=users["mod"][1],
    )
    assert response.status_code == 201
    assert response.get_json()["quote"]["total"]["cents"] == 2500
    assert client.get("/api/quotes", headers=auth(users["mod"][0])).get_json() == {"quotes": []}


def test_a_quote_keeps_a_copy_of_the_prices(client, catalog):
    users, place_id, cena, _ = catalog
    quote = _quote(client, users["beto"][0], place_id, [{"item_id": cena["id"], "quantity": 2}]).get_json()["quote"]
    url = f"/api/places/{place_id}/manage/quote-items/{cena['id']}"
    client.patch(url, json={"unit_price_cents": 9999, "name": "Renombrado"}, headers=auth(users["ana"][0]))
    after_edit = client.get(f"/api/quotes/{quote['id']}", headers=auth(users["beto"][0])).get_json()["quote"]
    assert after_edit["total"]["cents"] == 2500 and after_edit["lines"][0]["name"] == "Mesa para cenar"
    client.delete(url, headers=auth(users["ana"][0]))
    assert client.get(f"/api/quotes/{quote['id']}", headers=auth(users["beto"][0])).get_json()["quote"]["total"]["cents"] == 2500
    # Y una cotización nueva usa el precio vigente.
    assert _quote(client, users["beto"][0], place_id, [{"item_id": cena["id"], "quantity": 1}]).status_code == 404


def test_unknown_inactive_or_foreign_items_are_rejected_and_nothing_is_saved(client, app, catalog):
    users, place_id, cena, sala = catalog
    with app.app_context():
        other = insert_place("Otro lugar")
        db.session.execute(
            text("INSERT INTO place_quote_items (place_id, name, unit, unit_price_cents) VALUES (:p, 'Ajeno', 'unit', 100)"),
            {"p": other},
        )
        foreign = db.session.execute(text("SELECT id::text FROM place_quote_items WHERE name = 'Ajeno'")).scalar()
        db.session.commit()
    client.patch(f"/api/places/{place_id}/manage/quote-items/{sala['id']}", json={"is_active": False}, headers=auth(users["ana"][0]))

    for item_id in (MISSING, foreign, sala["id"]):
        response = _quote(client, users["beto"][0], place_id,
                          [{"item_id": cena["id"], "quantity": 1}, {"item_id": item_id, "quantity": 1}])
        assert response.status_code == 404
    assert _scalar(app, "SELECT count(*) FROM place_quotes") == 0
    assert _scalar(app, "SELECT count(*) FROM place_quote_lines") == 0


def test_only_public_places_can_be_quoted(client, app, catalog):
    users, _, cena, _ = catalog
    with app.app_context():
        hidden = insert_place("Oculto", active=False)
    for place_id in (hidden, MISSING):
        assert _quote(client, users["beto"][0], place_id, [{"item_id": cena["id"], "quantity": 1}]).status_code == 404


def test_requires_a_session(client, catalog):
    _, place_id, cena, _ = catalog
    assert client.post(f"/api/places/{place_id}/quotes", json={}).status_code == 401
    assert client.get("/api/quotes").status_code == 401
    assert client.get(f"/api/places/{place_id}/quote-items").status_code == 401


def test_invalid_note_and_reservation(client, catalog):
    users, place_id, cena, _ = catalog
    lines = [{"item_id": cena["id"], "quantity": 1}]
    assert _quote(client, users["beto"][0], place_id, lines, note="x" * 501).status_code == 400
    assert _quote(client, users["beto"][0], place_id, lines, reservation_id="no-uuid").status_code == 400
    assert _quote(client, users["beto"][0], place_id, lines, reservation_id=MISSING).status_code == 400


def test_a_quote_can_be_linked_to_my_own_reservation_only(client, app, catalog):
    users, place_id, cena, _ = catalog
    headers = auth(users["ana"][0])
    client.put(f"/api/places/{place_id}/manage/reservations/settings", json={"enabled": True}, headers=headers)
    from datetime import datetime, timedelta, timezone

    when = (datetime.now(timezone.utc) + timedelta(days=2)).replace(hour=19, minute=0, second=0, microsecond=0).isoformat()
    mine = client.post(f"/api/places/{place_id}/reservations", json={"starts_at": when, "party_size": 2}, headers=auth(users["beto"][0])).get_json()["reservation"]
    lines = [{"item_id": cena["id"], "quantity": 2}]

    ok = _quote(client, users["beto"][0], place_id, lines, reservation_id=mine["id"])
    assert ok.status_code == 201 and ok.get_json()["quote"]["reservation_id"] == mine["id"]
    # La reserva de otra persona no se puede enlazar.
    assert _quote(client, users["mod"][0], place_id, lines, reservation_id=mine["id"]).status_code == 400


def test_rate_limited(client, catalog, monkeypatch):
    from app.domain.rate_limiting import policy
    from app.domain.rate_limiting.policy import RateLimitRule

    users, place_id, cena, _ = catalog
    monkeypatch.setattr(policy, "QUOTE_WRITE", RateLimitRule("quote_write", 1, 3600, clear_on_success=False))
    lines = [{"item_id": cena["id"], "quantity": 1}]
    assert _quote(client, users["beto"][0], place_id, lines).status_code == 201
    assert _quote(client, users["beto"][0], place_id, lines).status_code == 429


# --- Ver cotizaciones ---------------------------------------------------------------------------


def test_who_can_see_a_quote(client, catalog):
    users, place_id, cena, _ = catalog
    quote = _quote(client, users["beto"][0], place_id, [{"item_id": cena["id"], "quantity": 1}]).get_json()["quote"]
    url = f"/api/quotes/{quote['id']}"

    assert client.get(url, headers=auth(users["beto"][0])).status_code == 200  # quien la pidió
    assert client.get(url, headers=auth(users["ana"][0])).status_code == 200  # quien gestiona el lugar
    assert client.get(url, headers=auth(users["mod"][0])).status_code == 404  # nadie más, ni moderación
    assert client.get(f"/api/quotes/{MISSING}", headers=auth(users["beto"][0])).status_code == 404
    mine = client.get("/api/quotes", headers=auth(users["beto"][0])).get_json()["quotes"]
    assert [q["id"] for q in mine] == [quote["id"]]


def test_the_manager_sees_quotes_requested_from_the_place(client, catalog):
    users, place_id, cena, _ = catalog
    _quote(client, users["beto"][0], place_id, [{"item_id": cena["id"], "quantity": 3}])
    result = client.get(f"/api/places/{place_id}/manage/quotes", headers=auth(users["ana"][0])).get_json()
    assert result["has_more"] is False
    only = result["quotes"][0]
    assert only["total"]["cents"] == 3750
    assert set(only["user"]) == {"id", "username", "name"} and only["user"]["id"] == users["beto"][1]
    assert client.get(f"/api/places/{place_id}/manage/quotes?limit=0", headers=auth(users["ana"][0])).status_code == 400


# --- Exportación y eliminación de cuenta -------------------------------------------------------------


def test_data_export_includes_my_quotes(client, app, catalog):
    users, place_id, cena, _ = catalog
    _quote(client, users["beto"][0], place_id, [{"item_id": cena["id"], "quantity": 2}], note="Mesa")
    from app.infrastructure.persistence.repositories.data_export_repository import (
        SQLAlchemyDataExportRepository,
    )

    with app.app_context():
        data = SQLAlchemyDataExportRepository().collect_user_data(users["beto"][1])
    quote = data["place_quotes"][0]
    assert quote["place"] == "Café Aurora" and quote["total"] == "25.00" and quote["currency"] == "USD"
    assert quote["lines"] == [{"name": "Mesa para cenar", "quantity": 2, "unit_price": "12.50", "line_total": "25.00"}]


def test_deleting_the_person_removes_their_quotes(client, app, catalog):
    users, place_id, cena, _ = catalog
    _quote(client, users["beto"][0], place_id, [{"item_id": cena["id"], "quantity": 1}])
    with app.app_context():
        db.session.execute(text("DELETE FROM users WHERE id = :i"), {"i": users["beto"][1]})
        db.session.commit()
    assert _scalar(app, "SELECT count(*) FROM place_quotes") == 0
    assert _scalar(app, "SELECT count(*) FROM place_quote_lines") == 0


def test_catalog_and_quotes_go_away_with_the_place(client, app, catalog):
    users, place_id, cena, _ = catalog
    _quote(client, users["beto"][0], place_id, [{"item_id": cena["id"], "quantity": 1}])
    with app.app_context():
        db.session.execute(text("DELETE FROM places WHERE id = :p"), {"p": place_id})
        db.session.commit()
    for table in ("place_quote_items", "place_quotes", "place_quote_lines"):
        assert _scalar(app, f"SELECT count(*) FROM {table}") == 0
