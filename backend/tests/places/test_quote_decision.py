# Cotizador, fase 11 (ADR-040): quien gestiona el lugar acepta o rechaza una cotización pendiente y
# vigente (solo un estado: no cobra ni cambia el total) y la cotización se descarga como PDF para
# quien la pidió o quien gestiona el lugar. El PDF solo dibuja importes ya calculados.

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from app.extensions import db
from app.infrastructure.pdf.quote_pdf import build_quote_pdf
from tests.places.helpers import auth, insert_place, make_users

MISSING = "00000000-0000-4000-8000-000000000000"


def _money(cents):
    return {"cents": cents, "amount": f"{cents // 100}.{cents % 100:02d}", "currency": "USD"}


def _fake_quote(lines=1, note=None, name="Mesa (para) \\ cena"):
    entries = [
        {"name": f"{name} {i}", "unit": "person", "unit_price": _money(1250), "quantity": 2,
         "line_total": _money(2500)}
        for i in range(lines)
    ]
    return {"lines": entries, "total": _money(2500 * lines), "note": note, "status": "pending",
            "created_at": "2026-10-09T10:00:00+00:00", "valid_until": "2026-10-16T10:00:00+00:00"}


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
    ana = users["ana"][0]
    item = client.post(
        f"/api/places/{place_id}/manage/quote-items",
        json={"name": "Menú", "unit": "person", "unit_price_cents": 1250},
        headers=auth(ana),
    ).get_json()["item"]
    quote = client.post(
        f"/api/places/{place_id}/quotes",
        json={"lines": [{"item_id": item["id"], "quantity": 4}]},
        headers=auth(users["beto"][0]),
    ).get_json()["quote"]
    return users, place_id, quote


def _decide(client, token, place_id, quote_id, body):
    return client.post(
        f"/api/places/{place_id}/manage/quotes/{quote_id}/decision", json=body, headers=auth(token)
    )


# --- PDF puro ---------------------------------------------------------------------------


def test_pdf_is_a_valid_document_with_the_given_amounts():
    pdf = build_quote_pdf("Café Aurora", "Beto Núñez", _fake_quote(note="Para 4 personas"))
    assert pdf.startswith(b"%PDF-1.4") and pdf.rstrip().endswith(b"%%EOF")
    assert b"/BaseFont /Helvetica" in pdf
    # El importe formateado por el servidor está tal cual: el PDF no recalcula.
    assert b"50.00" in pdf and b"12.50" in pdf
    # Tildes y ñ en WinAnsi (cp1252): «Café» -> 0xE9, «Núñez» -> 0xFA 0xF1.
    assert "Café".encode("cp1252") in pdf and "Núñez".encode("cp1252") in pdf


def test_pdf_escapes_user_text_so_it_cannot_close_the_string():
    quote = _fake_quote(name="x) Tj ET 1 0 0 rg (evil")
    pdf = build_quote_pdf("A) B", "C\x00D", quote)
    assert b"x\\) Tj ET 1 0 0 rg \\(evil" in pdf
    assert b"A\\) B" in pdf


def test_pdf_xref_offsets_point_at_each_object():
    pdf = build_quote_pdf("Lugar", "Persona", _fake_quote(lines=60, note="n " * 200))
    assert pdf.count(b"/Type /Page ") >= 2  # paginó
    start = int(pdf.rsplit(b"startxref\n", 1)[1].split(b"\n")[0])
    table = pdf[start:].split(b"\n")
    count = int(table[1].split()[1])
    for number in range(1, count):
        offset = int(table[2 + number].split()[0])
        assert pdf[offset:].startswith(b"%d 0 obj" % number)


def test_pdf_replaces_characters_outside_winansi():
    pdf = build_quote_pdf("Café ☕ 😀", "Ana", _fake_quote())
    assert b"Caf" in pdf and "☕".encode("utf-8") not in pdf


# --- Decisión --------------------------------------------------------------------------


def test_new_quotes_are_pending(world):
    _, _, quote = world
    assert quote["status"] == "pending" and quote["decided_at"] is None


def test_manager_accepts_and_the_total_does_not_change(client, world):
    users, place_id, quote = world
    response = _decide(client, users["ana"][0], place_id, quote["id"], {"decision": "accepted"})
    assert response.status_code == 200
    data = response.get_json()["quote"]
    assert data["status"] == "accepted" and data["decided_at"]
    assert data["total"] == quote["total"] and data["lines"] == quote["lines"]
    # La persona que la pidió ve el nuevo estado.
    mine = client.get(f"/api/quotes/{quote['id']}", headers=auth(users["beto"][0])).get_json()["quote"]
    assert mine["status"] == "accepted"


def test_manager_rejects(client, world):
    users, place_id, quote = world
    response = _decide(client, users["ana"][0], place_id, quote["id"], {"decision": "rejected"})
    assert response.status_code == 200 and response.get_json()["quote"]["status"] == "rejected"


def test_a_quote_is_decided_only_once(client, world):
    users, place_id, quote = world
    assert _decide(client, users["ana"][0], place_id, quote["id"], {"decision": "accepted"}).status_code == 200
    again = _decide(client, users["ana"][0], place_id, quote["id"], {"decision": "rejected"})
    assert again.status_code == 409
    assert client.get(f"/api/quotes/{quote['id']}", headers=auth(users["ana"][0])).get_json()["quote"]["status"] == "accepted"


def test_an_expired_quote_cannot_be_decided(app, client, world):
    users, place_id, quote = world
    with app.app_context():
        db.session.execute(
            text("UPDATE place_quotes SET valid_until = :v WHERE id = :q"),
            {"v": datetime.now(timezone.utc) - timedelta(minutes=1), "q": quote["id"]},
        )
        db.session.commit()
    response = _decide(client, users["ana"][0], place_id, quote["id"], {"decision": "accepted"})
    assert response.status_code == 409
    assert client.get(f"/api/quotes/{quote['id']}", headers=auth(users["ana"][0])).get_json()["quote"]["status"] == "pending"


@pytest.mark.parametrize("body", [{}, {"decision": "pending"}, {"decision": "ACCEPTED"}, {"decision": 1},
                                  {"decision": None}, {"decision": ["accepted"]}, {"status": "accepted"}])
def test_invalid_decisions_are_rejected_and_change_nothing(client, world, body):
    users, place_id, quote = world
    assert _decide(client, users["ana"][0], place_id, quote["id"], body).status_code == 400
    assert client.get(f"/api/quotes/{quote['id']}", headers=auth(users["ana"][0])).get_json()["quote"]["status"] == "pending"


def test_only_the_manager_can_decide(client, world):
    users, place_id, quote = world
    for who in ("beto", "mod"):  # quien la pidió y moderación reciben el mismo 404
        response = _decide(client, users[who][0], place_id, quote["id"], {"decision": "accepted"})
        assert response.status_code == 404, who
    assert client.post(
        f"/api/places/{place_id}/manage/quotes/{quote['id']}/decision", json={"decision": "accepted"}
    ).status_code == 401
    assert client.get(f"/api/quotes/{quote['id']}", headers=auth(users["ana"][0])).get_json()["quote"]["status"] == "pending"


def test_a_manager_cannot_decide_a_quote_of_another_place(app, client, world):
    users, place_id, quote = world
    with app.app_context():
        other = insert_place("Otro lugar")
        db.session.execute(
            text("INSERT INTO place_managers (place_id, user_id) VALUES (:p, :u)"),
            {"p": other, "u": users["mod"][1]},
        )
        db.session.commit()
    # `mod` gestiona OTRO lugar: con su propio place_id no encuentra la cotización de Aurora.
    assert _decide(client, users["mod"][0], other, quote["id"], {"decision": "accepted"}).status_code == 404
    assert _decide(client, users["ana"][0], place_id, MISSING, {"decision": "accepted"}).status_code == 404


def test_decision_does_not_trust_extra_fields(client, world):
    users, place_id, quote = world
    response = _decide(
        client, users["ana"][0], place_id, quote["id"],
        {"decision": "accepted", "total_cents": 1, "status": "rejected", "decided_by": MISSING},
    )
    data = response.get_json()["quote"]
    assert data["status"] == "accepted" and data["total"]["cents"] == quote["total"]["cents"]


def test_the_manager_list_shows_the_status(client, world):
    users, place_id, quote = world
    _decide(client, users["ana"][0], place_id, quote["id"], {"decision": "rejected"})
    listed = client.get(f"/api/places/{place_id}/manage/quotes", headers=auth(users["ana"][0])).get_json()["quotes"]
    assert listed[0]["status"] == "rejected"


# --- PDF por API ----------------------------------------------------------------------


def test_requester_and_manager_download_the_pdf(client, world):
    users, _, quote = world
    for who in ("beto", "ana"):
        response = client.get(f"/api/quotes/{quote['id']}/pdf", headers=auth(users[who][0]))
        assert response.status_code == 200, who
        assert response.mimetype == "application/pdf"
        assert response.data.startswith(b"%PDF-1.4")
        assert "attachment" in response.headers["Content-Disposition"]
        assert response.headers["Cache-Control"] == "no-store"
        assert b"50.00" in response.data  # 4 x 12.50, calculado por el servidor al pedirla


def test_the_pdf_is_private(client, world):
    users, _, quote = world
    assert client.get(f"/api/quotes/{quote['id']}/pdf", headers=auth(users["mod"][0])).status_code == 404
    assert client.get(f"/api/quotes/{MISSING}/pdf", headers=auth(users["ana"][0])).status_code == 404
    assert client.get(f"/api/quotes/{quote['id']}/pdf").status_code == 401


def test_the_pdf_shows_the_decision(client, world):
    users, place_id, quote = world
    _decide(client, users["ana"][0], place_id, quote["id"], {"decision": "accepted"})
    pdf = client.get(f"/api/quotes/{quote['id']}/pdf", headers=auth(users["beto"][0])).data
    assert b"Aceptada" in pdf
