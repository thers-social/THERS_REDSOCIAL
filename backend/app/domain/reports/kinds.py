# Tipos de objetivo, motivos y estados de un reporte
# (ADR-032-content-reports-and-moderation.md §1). Solo tipos nativos de Python
# -- domain/ no importa Flask ni SQLAlchemy (BACKEND_ARCHITECTURE.md §7/§17).
#
# Se validan en la aplicación, no con un ENUM de PostgreSQL: agregar un motivo
# nuevo no debería exigir una migración (mismo criterio que
# `domain/restrictions/kinds.py`, ADR-029).

TARGET_POST = "post"
TARGET_COMMENT = "comment"
TARGET_MESSAGE = "message"
TARGET_USER = "user"
#: Reseña de un lugar (ADR-040 fase 4a.2). Se reporta por el mismo `POST /api/reports`.
TARGET_REVIEW = "review"

TARGET_TYPES = (TARGET_POST, TARGET_COMMENT, TARGET_MESSAGE, TARGET_USER, TARGET_REVIEW)

REASON_SPAM = "spam"
REASON_HARASSMENT = "harassment"
REASON_HATE = "hate"
REASON_SEXUAL = "sexual"
REASON_VIOLENCE = "violence"
REASON_SELF_HARM = "self_harm"
REASON_ILLEGAL = "illegal"
REASON_IMPERSONATION = "impersonation"
REASON_OTHER = "other"
#: Explotación o abuso de menores (ADR-038-child-safety-reports.md). Tratamiento
#: prioritario: el servidor le asigna siempre prioridad `critical`.
REASON_CHILD_SAFETY = "child_safety"

REASONS = (
    REASON_SPAM,
    REASON_HARASSMENT,
    REASON_HATE,
    REASON_SEXUAL,
    REASON_VIOLENCE,
    REASON_SELF_HARM,
    REASON_ILLEGAL,
    REASON_IMPERSONATION,
    REASON_OTHER,
    REASON_CHILD_SAFETY,
)

# Prioridad de revisión (ADR-038). La decide SIEMPRE el servidor a partir del motivo:
# ningún cliente puede fijarla ni degradarla. Dos niveles; si más adelante hace falta
# otro, es un valor nuevo aquí (columna de texto con restricción, no un ENUM).
PRIORITY_NORMAL = "normal"
PRIORITY_CRITICAL = "critical"

PRIORITIES = (PRIORITY_NORMAL, PRIORITY_CRITICAL)

_PRIORITY_RANK = {PRIORITY_NORMAL: 0, PRIORITY_CRITICAL: 1}


def priority_for_reason(reason):
    """Prioridad que le corresponde a un reporte por su motivo."""
    return PRIORITY_CRITICAL if reason == REASON_CHILD_SAFETY else PRIORITY_NORMAL


def is_higher_priority(candidate, current):
    """`True` si `candidate` es estrictamente más urgente que `current`."""
    return _PRIORITY_RANK[candidate] > _PRIORITY_RANK[current]


STATUS_OPEN = "open"
STATUS_REVIEWING = "reviewing"
STATUS_ACTIONED = "actioned"
STATUS_DISMISSED = "dismissed"

#: Límite del texto libre. Placeholder de producto explícito y revisable
#: (ADR-032 §1), mismo criterio que `MAX_CONTENT_LENGTH` en `domain/posts`.
MAX_DETAILS_LENGTH = 500

#: Máximo de texto que se copia del contenido reportado (ADR-032 §4). La copia
#: existe para que quien modera vea *qué se dijo* aunque el contenido se borre;
#: no es un archivo, y se vacía al resolver el reporte (fase 2).
MAX_SNAPSHOT_LENGTH = 2000
