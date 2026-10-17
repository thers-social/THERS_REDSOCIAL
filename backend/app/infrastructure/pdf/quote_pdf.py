# PDF de una cotización (ADR-040 fase 11), SIN dependencias: un PDF 1.4 mínimo con la fuente
# estándar Helvetica (no se incrusta nada) y codificación WinAnsi, que cubre tildes y ñ.
#
# Solo DIBUJA lo que recibe: los importes llegan ya calculados y formateados por el servidor
# (`domain/quotes/quotes.py`); aquí no se suma ni se multiplica nada. Los textos son del usuario
# (nombre del negocio, artículos, nota), así que se limpian antes de entrar al contenido del PDF:
# el escape de `\`, `(` y `)` evita que un nombre cierre la cadena e inyecte operadores.

import re
import textwrap
from datetime import datetime, timezone

PAGE_WIDTH = 595  # A4 en puntos
PAGE_HEIGHT = 842
MARGIN = 50
LEADING = 16
BOTTOM = 70

_CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")
_STATUS_LABEL = {"pending": "Pendiente", "accepted": "Aceptada", "rejected": "Rechazada"}
_UNIT_LABEL = {"person": "por persona", "unit": "por unidad", "hour": "por hora"}


def _clean(value):
    """Texto seguro para el PDF: sin controles y solo caracteres que WinAnsi (cp1252) representa."""
    value = _CONTROL_RE.sub(" ", str(value))
    return value.encode("cp1252", errors="replace").decode("cp1252")


def _escape(value):
    return value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _text_width(value, size):
    # Helvetica: cifras 0,556 em; punto y espacio 0,278; el resto se aproxima. Solo se usa para
    # alinear importes a la derecha.
    width = 0.0
    for char in value:
        width += 0.556 if char.isdigit() else 0.278 if char in ". ," else 0.6
    return width * size


class _Page:
    def __init__(self):
        self.ops = []

    def text(self, x, y, value, size=11, bold=False):
        font = "F2" if bold else "F1"
        encoded = _escape(_clean(value)).encode("cp1252", errors="replace")
        self.ops.append(b"BT /%s %d Tf %.2f %.2f Td (" % (font.encode(), size, x, y) + encoded + b") Tj ET")

    def right(self, x_right, y, value, size=11, bold=False):
        self.text(x_right - _text_width(_clean(value), size), y, value, size, bold)

    def line(self, x1, y, x2):
        self.ops.append(b"0.5 w %.2f %.2f m %.2f %.2f l S" % (x1, y, x2, y))

    def stream(self):
        return b"\n".join(self.ops)


def _wrap(value, width):
    value = _clean(value)
    return textwrap.wrap(value, width=width, break_long_words=True) or [""]


def build_quote_pdf(place_name, requester, quote, generated_at=None):
    """Bytes de un PDF. `quote` es la cotización presentada por la API (`lines`, `total`,
    `note`, `status`, `valid_until`, `created_at`)."""
    generated_at = generated_at or datetime.now(timezone.utc)
    pages = [_Page()]
    y = PAGE_HEIGHT - MARGIN

    def current():
        return pages[-1]

    def need(space):
        nonlocal y
        if y - space < BOTTOM:
            pages.append(_Page())
            y = PAGE_HEIGHT - MARGIN

    right = PAGE_WIDTH - MARGIN
    current().text(MARGIN, y, "Cotización", 22, bold=True)
    y -= 26
    current().text(MARGIN, y, "THERS Places", 10)
    y -= 30

    for label, value in (
        ("Negocio", place_name),
        ("Solicitante", requester or "—"),
        ("Fecha", (quote.get("created_at") or "")[:10]),
        ("Válida hasta", (quote.get("valid_until") or "")[:10]),
        ("Estado", _STATUS_LABEL.get(quote.get("status"), "—")),
    ):
        for index, chunk in enumerate(_wrap(value, 70)):
            need(LEADING)
            if index == 0:
                current().text(MARGIN, y, label, 10, bold=True)
            current().text(MARGIN + 95, y, chunk, 11)
            y -= LEADING
    y -= 14

    # Tabla: artículo | cantidad | precio unitario | total.
    col_qty, col_price, col_total = 330, 430, right
    need(30)
    current().text(MARGIN, y, "Artículo", 10, bold=True)
    current().right(col_qty, y, "Cant.", 10, bold=True)
    current().right(col_price, y, "Precio (USD)", 10, bold=True)
    current().right(col_total, y, "Total (USD)", 10, bold=True)
    y -= 6
    current().line(MARGIN, y, right)
    y -= LEADING

    for line in quote["lines"]:
        names = _wrap(f"{line['name']} ({_UNIT_LABEL.get(line['unit'], line['unit'])})", 42)
        need(LEADING * len(names) + 4)
        current().text(MARGIN, y, names[0], 10)
        current().right(col_qty, y, str(line["quantity"]), 10)
        current().right(col_price, y, line["unit_price"]["amount"], 10)
        current().right(col_total, y, line["line_total"]["amount"], 10)
        for extra in names[1:]:
            y -= LEADING
            current().text(MARGIN, y, extra, 10)
        y -= LEADING

    need(40)
    current().line(MARGIN, y + 6, right)
    y -= 6
    current().text(MARGIN, y, "Total", 13, bold=True)
    current().right(col_total, y, f"{quote['total']['amount']} {quote['total']['currency']}", 13, bold=True)
    y -= 30

    if quote.get("note"):
        need(40)
        current().text(MARGIN, y, "Nota", 10, bold=True)
        y -= LEADING
        for raw in str(quote["note"]).splitlines() or [""]:
            for chunk in _wrap(raw, 85):
                need(LEADING)
                current().text(MARGIN, y, chunk, 10)
                y -= LEADING
        y -= 10

    need(50)
    for chunk in _wrap(
        "Documento informativo: no es una factura ni un compromiso de pago. Los importes los "
        "calculó el servidor con los precios del negocio vigentes al pedir la cotización.",
        95,
    ):
        current().text(MARGIN, y, chunk, 8)
        y -= 11
    current().text(MARGIN, y - 4, "Generado el " + generated_at.strftime("%Y-%m-%d") + " (UTC)", 8)

    return _assemble(pages)


def _assemble(pages):
    objects = []  # cada elemento: bytes del cuerpo del objeto (1-indexado al escribir)

    def add(body):
        objects.append(body)
        return len(objects)

    catalog = add(b"")  # se completa después
    pages_root = add(b"")
    font_regular = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
    font_bold = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>")

    page_ids = []
    for page in pages:
        content = page.stream()
        content_id = add(b"<< /Length %d >>\nstream\n" % len(content) + content + b"\nendstream")
        page_ids.append(
            add(
                b"<< /Type /Page /Parent %d 0 R /MediaBox [0 0 %d %d] "
                b"/Resources << /Font << /F1 %d 0 R /F2 %d 0 R >> >> /Contents %d 0 R >>"
                % (pages_root, PAGE_WIDTH, PAGE_HEIGHT, font_regular, font_bold, content_id)
            )
        )
    kids = b" ".join(b"%d 0 R" % page_id for page_id in page_ids)
    objects[pages_root - 1] = b"<< /Type /Pages /Kids [%s] /Count %d >>" % (kids, len(page_ids))
    objects[catalog - 1] = b"<< /Type /Catalog /Pages %d 0 R >>" % pages_root

    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % number + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    for offset in offsets:
        out += b"%010d 00000 n \n" % offset
    out += b"trailer\n<< /Size %d /Root %d 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (
        len(objects) + 1,
        catalog,
        xref,
    )
    return bytes(out)
