# PDF del comprobante de una reserva (ADR-052). Mismo formato mínimo sin dependencias que la
# cotización (`quote_pdf.py`): reutiliza su página, su limpieza de texto y su ensamblado.
#
# Solo DIBUJA lo que recibe. Una reserva no tiene importes (es una solicitud de cupo): el documento
# resume lugar, día, hora, personas y estado, y dice con claridad que no es un cobro ni una factura.

from datetime import datetime, timedelta, timezone

from app.infrastructure.pdf.quote_pdf import (
    BOTTOM,
    MARGIN,
    PAGE_HEIGHT,
    LEADING,
    _Page,
    _assemble,
    _wrap,
)

_STATUS_LABEL = {
    "pending": "Pendiente de confirmación",
    "confirmed": "Confirmada",
    "declined": "Rechazada",
    "cancelled": "Cancelada",
}
_SV = timezone(timedelta(hours=-6))  # El Salvador, sin horario de verano


def _local(iso):
    moment = datetime.fromisoformat(iso).astimezone(_SV)
    return moment.strftime("%d/%m/%Y"), moment.strftime("%H:%M")


def build_reservation_pdf(place_name, requester, reservation, generated_at=None):
    """Bytes de un PDF. `reservation` es la reserva presentada por la API."""
    generated_at = generated_at or datetime.now(timezone.utc)
    page = _Page()
    y = PAGE_HEIGHT - MARGIN
    day, hour = _local(reservation["starts_at"])
    people = reservation["party_size"]

    page.text(MARGIN, y, "Reserva", 22, bold=True)
    y -= 26
    page.text(MARGIN, y, "THERS Places", 10)
    y -= 30

    rows = [
        ("Lugar", place_name),
        ("A nombre de", requester or "—"),
        ("Día", day),
        ("Hora", hour + " (hora de El Salvador)"),
        ("Personas", f"{people} {'persona' if people == 1 else 'personas'}"),
        ("Estado", _STATUS_LABEL.get(reservation["status"], "—")),
        ("Solicitada el", (reservation.get("created_at") or "")[:10]),
    ]
    if reservation.get("note"):
        rows.append(("Tu nota", reservation["note"]))
    if reservation.get("decision_note"):
        rows.append(("Respuesta del lugar", reservation["decision_note"]))
    for label, value in rows:
        for index, chunk in enumerate(_wrap(value, 62)):
            if index == 0:
                page.text(MARGIN, y, label, 10, bold=True)
            page.text(MARGIN + 120, y, chunk, 11)
            y -= LEADING
    y -= 14

    for chunk in _wrap(
        "Comprobante informativo de una solicitud de reserva hecha en THERS. No es una factura ni un "
        "cobro. La reserva solo está garantizada cuando su estado es «Confirmada»; el lugar puede "
        "confirmarla o rechazarla.",
        95,
    ):
        if y < BOTTOM:
            break
        page.text(MARGIN, y, chunk, 8)
        y -= 11
    page.text(MARGIN, y - 4, "Generado el " + generated_at.strftime("%Y-%m-%d") + " (UTC)", 8)
    return _assemble([page])
