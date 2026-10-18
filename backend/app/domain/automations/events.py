# Eventos que el backend le entrega a n8n y reglas de los resúmenes semanales (ADR-041 §7).
# Solo tipos nativos de Python: domain/ no importa Flask ni SQLAlchemy.
#
# Principio: n8n recibe lo MÍNIMO para hacer su trabajo (enviar un correo) y no es fuente de
# verdad de nada. Quién debe recibir qué, y con qué números, lo decide siempre el backend.

import hashlib
from datetime import datetime, timedelta, timezone

EVENT_REPORT_RESOLVED = "report_resolved"

#: Desenlaces que se le cuentan a quien reportó. Deliberadamente solo dos y genéricos: no se dice
#: qué se hizo ni a quién, ni la nota de quien moderó (ADR-032).
OUTCOME_ACTIONED = "actioned"
OUTCOME_DISMISSED = "dismissed"

#: Estado de un reporte cerrado (`reports.status`) -> desenlace que se comunica.
_OUTCOME_BY_STATUS = {"actioned": OUTCOME_ACTIONED, "dismissed": OUTCOME_DISMISSED}

#: Cuántos resúmenes entrega el backend por llamada, como máximo.
MAX_SUMMARY_BATCH = 100
DEFAULT_SUMMARY_BATCH = 50


def outcome_for_status(status):
    """Desenlace para comunicar, o `None` si el estado no se notifica (p. ej. `open`)."""
    return _OUTCOME_BY_STATUS.get(status)


def idempotency_key(event_type, *parts):
    """Clave estable: el mismo evento sobre la misma cosa produce SIEMPRE la misma clave, así que
    n8n (o el backend al recibir el acuse) puede reconocer un reintento y no repetir el efecto."""
    raw = "|".join([event_type, *[str(part) for part in parts]])
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def report_resolved_payload(report_id, outcome, recipient_email, language="es"):
    """Cuerpo mínimo del aviso de reporte resuelto. Sin nombres, sin contenido, sin motivo."""
    return {
        "event": EVENT_REPORT_RESOLVED,
        "report_id": str(report_id),
        "outcome": outcome,
        "recipient_email": recipient_email,
        "language": language,
    }


# --- Resumen semanal ---------------------------------------------------------------------------


def week_start(moment):
    """Lunes 00:00 UTC de la semana de `moment`. Una semana = de lunes a domingo, en UTC."""
    moment = moment.astimezone(timezone.utc)
    monday = moment.date() - timedelta(days=moment.weekday())
    return datetime(monday.year, monday.month, monday.day, tzinfo=timezone.utc)


def summary_period(moment):
    """La semana COMPLETA ya terminada: del lunes anterior al lunes de esta semana (se resume
    lo que pasó, no lo que va de la semana en curso)."""
    end = week_start(moment)
    return end - timedelta(days=7), end


def weekly_summary_key(user_id, period_end):
    """Una clave por persona y semana: reenviar el mismo resumen dos veces es imposible de
    confundir con uno nuevo."""
    return idempotency_key("weekly_summary", user_id, period_end.date().isoformat())
