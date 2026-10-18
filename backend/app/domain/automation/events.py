# Eventos de dominio hacia n8n y firma de los mensajes (ADR-044 §2.8). Solo tipos nativos.
#
# Qué viaja a n8n: identificadores, categorías y CONTEOS. Nunca texto, imágenes, correos, nombres,
# `content_snapshot` ni URLs de archivos. Eso no se deja a la disciplina de quien llama: cada tipo
# de evento declara los únicos campos permitidos y `build_event` rechaza cualquier otro.
#
# n8n NO decide nada: estos eventos solo avisan. No existe ningún evento ni ruta para aprobar,
# rechazar, sancionar ni escribir un estado de moderación.

import hashlib
import hmac
import json
import re

CRITICAL_HELD = "moderation.critical_held"
JOB_DEAD = "moderation.job_dead"
APPEAL_OPENED = "moderation.appeal_opened"
APPEAL_OVERDUE = "moderation.appeal_overdue"
REPORT_CRITICAL = "report.critical_created"
BACKLOG = "moderation.backlog"

_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
_WORD = re.compile(r"^[a-z_]{1,32}$")


def _uuid(value):
    return isinstance(value, str) and bool(_UUID.match(value))


def _word(value):
    return isinstance(value, str) and bool(_WORD.match(value))


def _count(value):
    return isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 10_000_000


#: tipo -> {campo permitido: validador}. Un campo que no esté aquí no puede salir.
SCHEMAS = {
    CRITICAL_HELD: {"subject_type": _word, "subject_id": _uuid, "priority": _word, "reason": _word},
    JOB_DEAD: {"job_id": _uuid, "subject_type": _word, "attempts": _count},
    APPEAL_OPENED: {"appeal_id": _uuid, "subject_type": _word},
    APPEAL_OVERDUE: {"appeal_id": _uuid, "hours_open": _count},
    REPORT_CRITICAL: {"report_id": _uuid, "target_type": _word, "reason": _word},
    BACKLOG: {"held": _count, "critical": _count, "oldest_hours": _count},
}


class InvalidEventError(Exception):
    pass


def build_event(event_type, fields):
    """Devuelve el payload validado o lanza `InvalidEventError`. Estricto: tipo conocido, solo los
    campos declarados, todos presentes y con el formato exacto."""
    schema = SCHEMAS.get(event_type)
    if schema is None:
        raise InvalidEventError("unknown_event_type")
    if not isinstance(fields, dict) or set(fields) != set(schema):
        raise InvalidEventError("unexpected_fields")
    for name, valid in schema.items():
        if not valid(fields[name]):
            raise InvalidEventError("invalid_field")
    return dict(fields)


def idempotency_key(event_type, *parts):
    return ":".join([event_type, *[str(p) for p in parts]])[:120]


# --- Firma HMAC-SHA256 con marca de tiempo -----------------------------------------------------

SIGNATURE_HEADER = "X-Thers-Signature"
#: Una firma más vieja (o más futura) que esto se rechaza: acota la repetición de un mensaje robado.
TOLERANCE_SECONDS = 300


def body_bytes(payload):
    """Cuerpo canónico: JSON compacto y ordenado, para firmar exactamente lo que se envía."""
    return json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")


def sign(secret, timestamp, body):
    mac = hmac.new(secret.encode("utf-8"), f"{int(timestamp)}.".encode() + body, hashlib.sha256)
    return f"t={int(timestamp)},v1={mac.hexdigest()}"


def verify(secret, header, body, now_ts, tolerance=TOLERANCE_SECONDS):
    """`True` solo si la firma es válida para ese cuerpo Y reciente. Comparación en tiempo
    constante. Cualquier forma rara del encabezado es `False`, nunca una excepción."""
    if not secret or not isinstance(header, str):
        return False
    try:
        parts = dict(piece.split("=", 1) for piece in header.split(","))
        timestamp = int(parts["t"])
        given = parts["v1"]
    except (ValueError, KeyError):
        return False
    if abs(int(now_ts) - timestamp) > tolerance:
        return False
    expected = sign(secret, timestamp, body).split("v1=", 1)[1]
    return hmac.compare_digest(expected, given)
