# Resumen semanal de actividad (ADR-041 §7). El BACKEND decide quién lo recibe y con qué números;
# n8n solo lo recoge, lo convierte en un correo y avisa de que lo envió. Flujo:
#   1. n8n pide `next_batch`  -> el backend devuelve a quien lo activó y aún no lo recibió esta
#      semana, con conteos de la semana ya terminada (nunca contenido ni nombres ajenos);
#   2. n8n envía los correos;
#   3. n8n llama a `acknowledge` -> el backend marca el resumen como entregado. Es idempotente: si
#      el flujo se repite, nadie recibe dos resúmenes de la misma semana.

import uuid
from datetime import timedelta

from app.domain.automations import events


class InvalidBatchRequestError(Exception):
    def __init__(self, message):
        super().__init__(message)
        self.message = message


def _parse_limit(raw):
    if raw is None:
        return events.DEFAULT_SUMMARY_BATCH
    if isinstance(raw, bool) or not isinstance(raw, int) or not 1 <= raw <= events.MAX_SUMMARY_BATCH:
        raise InvalidBatchRequestError(f"limit debe ser un entero entre 1 y {events.MAX_SUMMARY_BATCH}")
    return raw


def _parse_uuid(raw, label):
    try:
        return str(uuid.UUID(str(raw)))
    except (ValueError, AttributeError, TypeError):
        raise InvalidBatchRequestError(f"{label} no es válido") from None


def next_batch(data, now, repository):
    if not isinstance(data, dict):
        data = {}
    limit = _parse_limit(data.get("limit"))
    after = _parse_uuid(data["after"], "after") if data.get("after") is not None else None

    start, end = events.summary_period(now)
    rows = repository.pending_weekly_summaries(start, end, limit, after)
    last_day = (end - timedelta(days=1)).date().isoformat()
    return {
        "period": {"from": start.date().isoformat(), "to": last_day},
        "items": [
            {
                "user_id": str(row["id"]),
                "recipient_email": row["email"],
                # Solo el primer nombre, para el saludo: no hace falta más.
                "first_name": (row["name"] or "").split(" ")[0],
                "language": "es",
                "metrics": {
                    "new_followers": row["new_followers"],
                    "likes_received": row["likes_received"],
                    "comments_received": row["comments_received"],
                    "unread_notifications": row["unread_notifications"],
                },
                "idempotency_key": events.weekly_summary_key(row["id"], end),
            }
            for row in rows
        ],
        # Cursor para la página siguiente; `null` si esta ya fue la última.
        "next_after": str(rows[-1]["id"]) if len(rows) == limit else None,
    }


def acknowledge(data, now, repository):
    """Marca como entregados los resúmenes que n8n dice haber enviado. Solo cuenta lo que lleve la
    clave que corresponde a ESTA semana: una clave vieja o inventada se ignora sin más."""
    items = data.get("items") if isinstance(data, dict) else None
    if not isinstance(items, list) or not 1 <= len(items) <= events.MAX_SUMMARY_BATCH:
        raise InvalidBatchRequestError(f"items debe ser una lista de 1 a {events.MAX_SUMMARY_BATCH}")

    _, end = events.summary_period(now)
    recorded = ignored = 0
    for item in items:
        if not isinstance(item, dict):
            ignored += 1
            continue
        try:
            user_id = _parse_uuid(item.get("user_id"), "user_id")
        except InvalidBatchRequestError:
            ignored += 1
            continue
        valid_key = item.get("idempotency_key") == events.weekly_summary_key(user_id, end)
        # `failed` no se registra: queda pendiente y n8n lo recibirá en la siguiente corrida.
        if not valid_key or item.get("status") != "sent":
            ignored += 1
            continue
        if repository.mark_weekly_summary_sent(user_id, end, now):
            recorded += 1
        else:
            ignored += 1
    return {"recorded": recorded, "ignored": ignored}
