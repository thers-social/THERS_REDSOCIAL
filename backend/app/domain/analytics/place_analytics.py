# Estadísticas de un lugar para quien lo gestiona (ADR-040 §31): armar la serie diaria, ocultar
# lo sensible cuando hay pocos datos y comparar con el periodo anterior. Lógica PURA, sin base
# de datos ni reloj propio: la consulta entrega filas ya agrupadas por día y esta lógica las ordena.
#
# PRIVACIDAD: solo hay conteos. Guardados y planes se ocultan (`None`) si el periodo suma menos
# de `MIN_SENSITIVE`: con poca gente un número diario permitiría deducir quién fue.

from datetime import date, timedelta

from app.domain.places.exceptions import InvalidPlaceQueryError

DAYS_ALLOWED = (7, 30, 90)
DEFAULT_DAYS = 30
MIN_SENSITIVE = 5
UTC_OFFSET_HOURS = -6  # El Salvador, sin horario de verano (igual que el horario de reservas)

# Métricas con una sola cifra por día, y cuáles se ocultan con pocos datos.
SIMPLE_METRICS = ("reviews", "reservations", "quotes", "posts", "saves", "plans")
SENSITIVE_METRICS = ("saves", "plans")

VISIT_EVENTS = ("view", "phone", "website", "directions")  # = domain/visits/place_visits.EVENTS

RESERVATION_STATUSES = ("pending", "confirmed", "declined", "cancelled")
QUOTE_STATUSES = ("pending", "accepted", "rejected")


def parse_days(raw):
    """`7`, `30` o `90` (texto o entero). Sin valor, 30. Cualquier otra cosa es un 400."""
    if raw is None or (isinstance(raw, str) and raw.strip() == ""):
        return DEFAULT_DAYS
    if isinstance(raw, bool):
        raise InvalidPlaceQueryError("days debe ser 7, 30 o 90")
    text = str(raw).strip()
    # `int()` acepta otros alfabetos de dígitos (p. ej. «٧»): solo se admiten los de ASCII.
    if not (text.isascii() and text.isdigit()):
        raise InvalidPlaceQueryError("days debe ser 7, 30 o 90")
    days = int(text)
    if days not in DAYS_ALLOWED:
        raise InvalidPlaceQueryError("days debe ser 7, 30 o 90")
    return days


def local_today(now_utc):
    """La fecha de hoy en El Salvador a partir de un instante UTC."""
    return (now_utc + timedelta(hours=UTC_OFFSET_HOURS)).date()


def period_bounds(today, days):
    """Fechas locales `(inicio, fin)` del periodo actual (incluidas) y del anterior de igual largo."""
    current_start = today - timedelta(days=days - 1)
    previous_start = current_start - timedelta(days=days)
    previous_end = current_start - timedelta(days=1)
    return {
        "current": (current_start, today),
        "previous": (previous_start, previous_end),
    }


def _day_list(start, end):
    return [start + timedelta(days=i) for i in range((end - start).days + 1)]


def _sum(values):
    return sum(values)


def change(current, previous):
    """Variación frente al periodo anterior. `None` si no se puede calcular (alguno oculto o el
    anterior fue 0: no se inventa un «infinito %»)."""
    if current is None or previous is None or previous == 0:
        return None
    return round((current - previous) * 100 / previous)


def _by_day(rows, key="count"):
    out = {}
    for row in rows:
        out[row["day"]] = out.get(row["day"], 0) + int(row[key])
    return out


def _visit_totals(rows, start, end):
    totals = {event: 0 for event in VISIT_EVENTS}
    for row in rows:
        if start <= row["day"] <= end and row["event"] in totals:
            totals[row["event"]] += int(row["count"])
    return totals


def _status_totals(rows, statuses, start, end):
    totals = {status: 0 for status in statuses}
    for row in rows:
        if start <= row["day"] <= end and row["status"] in totals:
            totals[row["status"]] += int(row["count"])
    return totals


def build_report(data, today, days, format_money):
    """Respuesta pública a partir de filas agrupadas por día.

    `data` trae, ya filtradas por lugar y por el rango de los dos periodos:
    `reviews` (`day`, `count`, `rating_sum`), `saves`, `plans`, `posts` (`day`, `count`),
    `reservations` (`day`, `status`, `count`, `people`), `quotes` (`day`, `status`, `count`,
    `total_cents`) y `visits` (`day`, `event`, `count`: contadores anónimos, ADR-040 §33). `format_money` convierte centavos en `{cents, amount, currency}`.
    """
    bounds = period_bounds(today, days)
    c_start, c_end = bounds["current"]
    p_start, p_end = bounds["previous"]
    dates = _day_list(c_start, c_end)

    per_day = {
        "reviews": _by_day(data["reviews"]),
        "saves": _by_day(data["saves"]),
        "plans": _by_day(data["plans"]),
        "posts": _by_day(data["posts"]),
        "reservations": _by_day(data["reservations"]),
        "quotes": _by_day(data["quotes"]),
    }

    def period_total(metric, start, end):
        return _sum(count for day, count in per_day[metric].items() if start <= day <= end)

    totals = {metric: period_total(metric, c_start, c_end) for metric in SIMPLE_METRICS}
    previous = {metric: period_total(metric, p_start, p_end) for metric in SIMPLE_METRICS}

    hidden = []
    for metric in SENSITIVE_METRICS:
        if totals[metric] < MIN_SENSITIVE:
            hidden.append(metric)
            totals[metric] = None
        if previous[metric] < MIN_SENSITIVE:
            previous[metric] = None

    # Visitas (ADR-040 §33): son contadores anónimos, pero con muy pocas un número diario sigue
    # siendo casi individual. Se ocultan TODAS si el periodo suma menos de MIN_SENSITIVE.
    visit_rows = data.get("visits", [])
    visits = _visit_totals(visit_rows, c_start, c_end)
    previous_visits = _visit_totals(visit_rows, p_start, p_end)
    visits_hidden = _sum(visits.values()) < MIN_SENSITIVE
    views_by_day = {row["day"]: int(row["count"]) for row in visit_rows if row["event"] == "view"}
    if visits_hidden:
        hidden.append("visits")
    previous_views = None if _sum(previous_visits.values()) < MIN_SENSITIVE else previous_visits["view"]

    series = []
    for current_date in dates:
        point = {"date": current_date.isoformat()}
        for metric in SIMPLE_METRICS:
            point[metric] = None if metric in hidden else per_day[metric].get(current_date, 0)
        point["views"] = None if visits_hidden else views_by_day.get(current_date, 0)
        series.append(point)

    # Tasa de conversión: de ver la ficha a pedir una reserva o una cotización. Sin visitas
    # suficientes no hay tasa, y si hubo más solicitudes que visitas (p. ej. antes de que existiera
    # el contador) tampoco: no se inventa un porcentaje mayor a 100.
    requests = totals["reservations"] + totals["quotes"]
    conversion = None
    if not visits_hidden and visits["view"] > 0 and requests <= visits["view"]:
        conversion = round(requests * 100 / visits["view"], 1)

    in_current = [row for row in data["reviews"] if c_start <= row["day"] <= c_end]
    review_count = _sum(int(row["count"]) for row in in_current)
    rating_average = (
        round(_sum(int(row["rating_sum"]) for row in in_current) / review_count, 1) if review_count else None
    )

    reservation_status = _status_totals(data["reservations"], RESERVATION_STATUSES, c_start, c_end)
    people_confirmed = _sum(
        int(row["people"])
        for row in data["reservations"]
        if c_start <= row["day"] <= c_end and row["status"] == "confirmed"
    )
    quote_status = _status_totals(data["quotes"], QUOTE_STATUSES, c_start, c_end)
    accepted_cents = _sum(
        int(row["total_cents"])
        for row in data["quotes"]
        if c_start <= row["day"] <= c_end and row["status"] == "accepted"
    )

    return {
        "range": {
            "days": days,
            "from": c_start.isoformat(),
            "to": c_end.isoformat(),
            "previous_from": p_start.isoformat(),
            "previous_to": p_end.isoformat(),
            "timezone": "UTC-06:00",
        },
        "min_count": MIN_SENSITIVE,
        "hidden": hidden,
        "series": series,
        "totals": {
            "reviews": totals["reviews"],
            "rating_average": rating_average,
            "reservations": {
                "requested": totals["reservations"],
                "confirmed": reservation_status["confirmed"],
                "declined": reservation_status["declined"],
                "cancelled": reservation_status["cancelled"],
                "pending": reservation_status["pending"],
                "people_confirmed": people_confirmed,
            },
            "quotes": {
                "requested": totals["quotes"],
                "accepted": quote_status["accepted"],
                "rejected": quote_status["rejected"],
                "pending": quote_status["pending"],
                "accepted_value": format_money(accepted_cents),
            },
            "visits": None
            if visits_hidden
            else {
                "views": visits["view"],
                "phone": visits["phone"],
                "website": visits["website"],
                "directions": visits["directions"],
                "conversion_percent": conversion,
            },
            "posts": totals["posts"],
            "saves": totals["saves"],
            "plans": totals["plans"],
        },
        "previous": {**previous, "views": previous_views},
        "change": {
            **{metric: change(totals[metric], previous[metric]) for metric in SIMPLE_METRICS},
            "views": change(None if visits_hidden else visits["view"], previous_views),
        },
    }
