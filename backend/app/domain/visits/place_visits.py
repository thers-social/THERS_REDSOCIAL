# Visitas a la ficha de un lugar (ADR-040 §33): QUÉ eventos se cuentan. Lógica PURA.
#
# PRIVACIDAD: solo existe un contador anónimo por lugar, día y tipo de evento. No se guarda
# quién, desde dónde, con qué dispositivo ni a qué hora exacta. Las visitas de quien gestiona
# el lugar no se cuentan (nadie debe poder inflar sus propias cifras).

from app.domain.places.exceptions import InvalidPlaceDataError

EVENTS = ("view", "phone", "website", "directions")


def parse_event(raw):
    """Devuelve el evento válido, o lanza `InvalidPlaceDataError` (400)."""
    if isinstance(raw, str) and raw.strip().lower() in EVENTS:
        return raw.strip().lower()
    raise InvalidPlaceDataError(f"event debe ser uno de: {', '.join(EVENTS)}")
