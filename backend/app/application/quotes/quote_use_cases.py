# Casos de uso del cotizador (ADR-040 fase 10).
#
# Catálogo: lo edita solo quien gestiona el lugar (404 a cualquier otra cuenta); lo lee cualquiera
# con sesión (solo artículos activos). Cotización: la pide una persona con sesión sobre un lugar
# público; el total lo calcula el servidor (`domain/quotes/quotes.py`) con los precios vigentes y
# se guarda una COPIA de cada línea. La ve quien la pidió y quien gestiona el lugar.

from app.application.places.place_card import to_place_card
from app.domain.notifications import place_events
from app.domain.places.exceptions import PlaceNotFoundError
from app.domain.quotes import quotes
from app.domain.quotes.quotes import (
    InvalidQuoteDataError,
    QuoteAlreadyDecidedError,
    QuoteExpiredError,
    QuoteItemNotFoundError,
    QuoteNotFoundError,
)
from app.infrastructure.pdf.quote_pdf import build_quote_pdf


def _iso(value):
    return value.isoformat() if value is not None else None


def _money(cents):
    return {"cents": cents, "amount": quotes.format_money(cents), "currency": quotes.CURRENCY}


def _present_item(row):
    return {
        "id": str(row["id"]),
        "name": row["name"],
        "description": row["description"],
        "unit": row["unit"],
        "unit_price": _money(row["unit_price_cents"]),
        "is_active": bool(row["is_active"]),
    }


def _present_quote(row, lines, card=None, person=None):
    data = {
        "id": str(row["id"]),
        "total": _money(row["total_cents"]),
        "note": row["note"],
        "valid_until": _iso(row["valid_until"]),
        "status": row["status"],
        "decided_at": _iso(row["decided_at"]),
        "created_at": _iso(row["created_at"]),
        "reservation_id": str(row["reservation_id"]) if row["reservation_id"] else None,
        "lines": [
            {
                "name": line["name"],
                "unit": line["unit"],
                "unit_price": _money(line["unit_price_cents"]),
                "quantity": line["quantity"],
                "line_total": _money(line["line_total_cents"]),
            }
            for line in lines
        ],
    }
    if person is not None:
        data["user"] = person
    else:
        data["place"] = card
    return data


def _require_public(place_id, repository):
    if not repository.public_place_exists(place_id):
        raise PlaceNotFoundError()


def _require_manager(place_id, user_id, repository):
    # Mismo 404 que si el lugar no existiera.
    if not repository.is_manager(place_id, user_id) or not repository.public_place_exists(place_id):
        raise PlaceNotFoundError()


# ------------------------------------------------------------------ catálogo


def public_items(place_id, repository):
    _require_public(place_id, repository)
    return [_present_item(row) for row in repository.list_items(place_id, only_active=True)]


def manage_items(place_id, user_id, repository):
    _require_manager(place_id, user_id, repository)
    return [_present_item(row) for row in repository.list_items(place_id, only_active=False)]


def create_item(place_id, user_id, data, repository):
    _require_manager(place_id, user_id, repository)
    fields = quotes.parse_item(data)
    item_id = repository.create_item(place_id, fields)
    return _present_item(repository.get_item(place_id, item_id))


def update_item(place_id, item_id, user_id, data, repository):
    _require_manager(place_id, user_id, repository)
    fields = quotes.parse_item(data, partial=True)
    if repository.get_item(place_id, item_id) is None:
        raise QuoteItemNotFoundError()
    # Reactivar también respeta el tope de artículos activos.
    if fields.get("is_active") and not repository.get_item(place_id, item_id)["is_active"]:
        if repository.count_active_items(place_id) >= quotes.MAX_ACTIVE_ITEMS_PER_PLACE:
            raise quotes.QuoteItemLimitError()
    repository.update_item(place_id, item_id, fields)
    return _present_item(repository.get_item(place_id, item_id))


def delete_item(place_id, item_id, user_id, repository):
    _require_manager(place_id, user_id, repository)
    if not repository.delete_item(place_id, item_id):
        raise QuoteItemNotFoundError()
    return {"deleted": True}


# ------------------------------------------------------------------ cotizaciones


def create_quote(place_id, user_id, data, repository):
    lines = quotes.parse_lines(data.get("lines"))
    note = quotes.parse_note(data.get("note"))
    _require_public(place_id, repository)
    reservation_id = data.get("reservation_id")
    if reservation_id is not None:
        import uuid

        try:
            reservation_id = str(uuid.UUID(reservation_id))
        except (ValueError, AttributeError, TypeError):
            raise InvalidQuoteDataError("reservation_id debe ser un identificador válido")
        if not repository.reservation_belongs_to(reservation_id, user_id, place_id):
            raise InvalidQuoteDataError("reservation_id no es una reserva tuya en este lugar")
    quote_id = repository.create_quote(place_id, user_id, reservation_id, lines, note)
    repository.notify_managers(place_events.QUOTE_NEW, place_id, quote_id, user_id)
    return _one_own(quote_id, repository)


def _one_own(quote_id, repository):
    row = repository.get_quote(quote_id)
    cards = repository.place_cards([row["place_id"]])
    return _present_quote(
        row, repository.lines_of([row["id"]]).get(str(row["id"]), []), to_place_card(row["place_id"], cards)
    )


def list_own(user_id, repository):
    rows = repository.list_for_user(user_id, quotes.MAX_LIST)
    lines = repository.lines_of([r["id"] for r in rows])
    cards = repository.place_cards([r["place_id"] for r in rows])
    return [
        _present_quote(r, lines.get(str(r["id"]), []), to_place_card(r["place_id"], cards)) for r in rows
    ]


def get_quote(quote_id, user_id, repository):
    """La ve quien la pidió y quien gestiona ese lugar; cualquier otra cuenta, 404."""
    row = repository.get_quote(quote_id)
    if row is None:
        raise QuoteNotFoundError()
    mine = str(row["user_id"]) == str(user_id)
    if not mine and not repository.is_manager(row["place_id"], user_id):
        raise QuoteNotFoundError()
    return _one_own(quote_id, repository)


def list_for_place(place_id, user_id, limit_raw, offset_raw, repository):
    _require_manager(place_id, user_id, repository)
    try:
        limit = min(int(limit_raw), quotes.MAX_LIST) if limit_raw not in (None, "") else 20
        offset = max(int(offset_raw), 0) if offset_raw not in (None, "") else 0
    except (TypeError, ValueError):
        raise InvalidQuoteDataError("limit y offset deben ser números")
    if limit < 1:
        raise InvalidQuoteDataError("limit debe ser mayor que cero")
    rows = repository.list_for_place(place_id, limit, offset)
    lines = repository.lines_of([r["id"] for r in rows[:limit]])
    return [
        _present_quote(
            r, lines.get(str(r["id"]), []),
            person={"id": str(r["user_id"]), "username": r["user_username"], "name": r["user_name"]},
        )
        for r in rows[:limit]
    ], len(rows) > limit


# ------------------------------------------------------------------ fase 11: decisión y PDF


def decide_quote(place_id, quote_id, user_id, data, repository):
    """Quien gestiona el lugar acepta o rechaza una cotización pendiente y vigente. Es solo un
    estado: no cobra, no reserva cupo y no cambia el total."""
    _require_manager(place_id, user_id, repository)
    decision = quotes.parse_decision(data)
    result = repository.decide(quote_id, place_id, decision, user_id)
    if result is None:
        raise QuoteNotFoundError()
    if result == "decided":
        raise QuoteAlreadyDecidedError()
    if result == "expired":
        raise QuoteExpiredError()
    row = repository.get_quote(quote_id)
    repository.notify_people(
        place_events.QUOTE_DECIDED, place_id, quote_id, [row["user_id"]], user_id, detail=decision
    )
    return _present_quote(
        row,
        repository.lines_of([row["id"]]).get(str(row["id"]), []),
        person=_person(row, repository),
    )


def _person(row, repository):
    return {"id": str(row["user_id"]), "username": None, "name": repository.requester_name(row["user_id"])}


def quote_pdf(quote_id, user_id, repository):
    """PDF de una cotización para quien la pidió o quien gestiona el lugar (el resto, 404).
    Los importes son los guardados: el PDF no recalcula nada."""
    presented = get_quote(quote_id, user_id, repository)
    row = repository.get_quote(quote_id)
    return build_quote_pdf(
        repository.place_name(row["place_id"]),
        repository.requester_name(row["user_id"]),
        presented,
    )
