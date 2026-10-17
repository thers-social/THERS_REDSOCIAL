# Constantes de las reservas (ADR-040 fase 8).

PENDING = "pending"
CONFIRMED = "confirmed"
DECLINED = "declined"
CANCELLED = "cancelled"
STATUSES = (PENDING, CONFIRMED, DECLINED, CANCELLED)
# Estados que ocupan cupo.
ACTIVE_STATUSES = (PENDING, CONFIRMED)

MAX_NOTE_LENGTH = 300
MAX_DAYS_AHEAD = 90
SLOT_MINUTES = 15  # el horario se pide en cuartos de hora exactos
MIN_LEAD_MINUTES = 30  # no se reserva para dentro de menos de media hora
MAX_ACTIVE_PER_USER = 5
MAX_LIST = 50

DEFAULT_CAPACITY = 10
DEFAULT_MAX_PARTY = 8
