# Pulse de un lugar (ADR-040 §32): un NIVEL cualitativo de actividad reciente, nunca una cifra.
# Lógica PURA, sin base de datos ni reloj. La consulta entrega conteos de los últimos 7 días y
# esta lógica decide si se muestran y con qué etiqueta.
#
# PRIVACIDAD: el nivel se calcula sobre la SUMA de varias fuentes y por debajo de MIN_EVENTS no se
# devuelve nada (`level: None`), así ni el nivel permite deducir quién guardó o reseñó el lugar.
# La respuesta no lleva conteos, identificadores ni desglose por fuente.

WINDOW_DAYS = 7
MIN_EVENTS = 5  # el mismo mínimo que las estadísticas (place_analytics.MIN_SENSITIVE)
ACTIVE_FROM = 15
BUZZING_FROM = 40

SOURCES = ("reviews", "saves", "plans", "posts")
LEVELS = ("moving", "active", "buzzing")


def level_for(total):
    """`None` por debajo del mínimo; si no, `moving`, `active` o `buzzing`."""
    if total < MIN_EVENTS:
        return None
    if total >= BUZZING_FROM:
        return "buzzing"
    if total >= ACTIVE_FROM:
        return "active"
    return "moving"


def build_pulse(counts):
    """`counts` trae un entero por fuente (`SOURCES`); lo que falte o sea negativo cuenta 0."""
    total = sum(max(0, int(counts.get(source) or 0)) for source in SOURCES)
    return {"level": level_for(total), "window_days": WINDOW_DAYS}
