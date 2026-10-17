# Cotizador de THERS Places (ADR-040 fase 10): constantes, errores, validación y CÁLCULO.
# Funciones puras, sin base de datos.
#
# REGLA CENTRAL: el total lo calcula SIEMPRE el servidor, con enteros (centavos de USD), a partir
# del catálogo del propio negocio. El cliente solo dice qué artículo y cuántos; nunca manda un
# precio ni un total. No hay `float` en ningún punto del cálculo.

import re
import uuid
from datetime import timedelta

UNITS = ("person", "unit", "hour")
CURRENCY = "USD"

MAX_ITEM_NAME = 120
MAX_ITEM_DESCRIPTION = 300
MAX_PRICE_CENTS = 100_000_000  # 1 000 000,00 USD por unidad
MAX_ACTIVE_ITEMS_PER_PLACE = 30
MAX_LINES = 20
MAX_QUANTITY = 10_000
MAX_NOTE = 500
VALID_FOR = timedelta(days=7)
DECISIONS = ("accepted", "rejected")
MAX_LIST = 50

_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


class InvalidQuoteDataError(Exception):
    """Un dato no es válido. `message` va tal cual en `{"msg": ...}` con 400."""

    def __init__(self, message):
        super().__init__(message)
        self.message = message


class QuoteNotFoundError(Exception):
    """No existe, o la persona no es parte de ella (404 sin distinguir)."""


class QuoteAlreadyDecidedError(Exception):
    """La cotización ya fue aceptada o rechazada (409)."""


class QuoteExpiredError(Exception):
    """La cotización venció: ya no se puede decidir (409)."""


class QuoteItemNotFoundError(Exception):
    """El artículo no existe en ese negocio (404)."""


class QuoteItemLimitError(Exception):
    """El negocio ya tiene el máximo de artículos (409)."""


class QuoteItemNameTakenError(Exception):
    """Ya hay un artículo con ese nombre (409)."""


def _text(value, label, max_length, required=False, multiline=False):
    if value is None or (isinstance(value, str) and not value.strip()):
        if required:
            raise InvalidQuoteDataError(f"{label} es obligatorio")
        return None
    if not isinstance(value, str):
        raise InvalidQuoteDataError(f"{label} debe ser texto")
    value = value.strip()
    if not multiline and ("\n" in value or "\r" in value or "\t" in value):
        raise InvalidQuoteDataError(f"{label} no puede tener saltos de línea")
    if _CONTROL_RE.search(value):
        raise InvalidQuoteDataError(f"{label} tiene caracteres no permitidos")
    if len(value) > max_length:
        raise InvalidQuoteDataError(f"{label} no puede superar {max_length} caracteres")
    return value


def parse_item(data, partial=False):
    """Campos limpios de un artículo del catálogo. El precio llega como ENTERO de centavos en
    `unit_price_cents`; se rechaza cualquier `float`, texto o `bool`."""
    clean = {}
    if not partial or "name" in data:
        clean["name"] = _text(data.get("name"), "name", MAX_ITEM_NAME, required=True)
    if not partial or "description" in data:
        clean["description"] = _text(data.get("description"), "description", MAX_ITEM_DESCRIPTION)
    if not partial or "unit" in data:
        unit = data.get("unit")
        if unit not in UNITS:
            raise InvalidQuoteDataError("unit debe ser person, unit o hour")
        clean["unit"] = unit
    if not partial or "unit_price_cents" in data:
        clean["unit_price_cents"] = parse_cents(data.get("unit_price_cents"))
    if "is_active" in data:
        if not isinstance(data["is_active"], bool):
            raise InvalidQuoteDataError("is_active debe ser verdadero o falso")
        clean["is_active"] = data["is_active"]
    if partial and not clean:
        raise InvalidQuoteDataError("No se enviaron campos para actualizar")
    return clean


def parse_cents(value):
    # `bool` es subclase de int; los decimales binarios (float) no se aceptan para dinero.
    if isinstance(value, bool) or not isinstance(value, int):
        raise InvalidQuoteDataError("unit_price_cents debe ser un entero de centavos")
    if not 0 <= value <= MAX_PRICE_CENTS:
        raise InvalidQuoteDataError(f"unit_price_cents debe estar entre 0 y {MAX_PRICE_CENTS}")
    return value


def parse_lines(raw):
    """`[{item_id, quantity}]` -> lista de `(item_id, cantidad)`. Sin artículos repetidos."""
    if not isinstance(raw, list) or not raw:
        raise InvalidQuoteDataError("lines debe tener al menos un artículo")
    if len(raw) > MAX_LINES:
        raise InvalidQuoteDataError(f"lines no puede tener más de {MAX_LINES} artículos")
    seen = set()
    lines = []
    for entry in raw:
        if not isinstance(entry, dict):
            raise InvalidQuoteDataError("cada línea debe ser un objeto")
        item_id = entry.get("item_id")
        try:
            item_id = str(uuid.UUID(item_id)) if isinstance(item_id, str) else None
        except ValueError:
            item_id = None
        if item_id is None:
            raise InvalidQuoteDataError("item_id debe ser un identificador válido")
        quantity = entry.get("quantity")
        if isinstance(quantity, bool) or not isinstance(quantity, int) or not 1 <= quantity <= MAX_QUANTITY:
            raise InvalidQuoteDataError(f"quantity debe ser un entero entre 1 y {MAX_QUANTITY}")
        if item_id in seen:
            raise InvalidQuoteDataError("un artículo no puede repetirse")
        seen.add(item_id)
        lines.append((item_id, quantity))
    return lines


def parse_note(value):
    return _text(value, "note", MAX_NOTE, multiline=True)


def compute(items_by_id, lines):
    """Líneas calculadas y total, todo en centavos enteros.
    `items_by_id`: `{item_id(str): {id, name, unit, unit_price_cents}}`."""
    computed = []
    total = 0
    for item_id, quantity in lines:
        item = items_by_id[item_id]
        line_total = item["unit_price_cents"] * quantity
        computed.append(
            {
                "item_id": item["id"],
                "name": item["name"],
                "unit": item["unit"],
                "unit_price_cents": item["unit_price_cents"],
                "quantity": quantity,
                "line_total_cents": line_total,
            }
        )
        total += line_total
    return computed, total


def format_money(cents):
    """«12.50» a partir de centavos enteros, sin pasar por float."""
    whole, fraction = divmod(cents, 100)
    return f"{whole}.{fraction:02d}"


def parse_decision(data):
    """`{"decision": "accepted" | "rejected"}`. Cualquier otro valor se rechaza."""
    decision = data.get("decision") if isinstance(data, dict) else None
    if decision not in DECISIONS:
        raise InvalidQuoteDataError("decision debe ser accepted o rejected")
    return decision
