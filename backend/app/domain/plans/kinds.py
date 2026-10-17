# Estados y límites de los planes con amistades (ADR-040 fase 5). Solo tipos nativos.

PLAN_ACTIVE = "active"
PLAN_CANCELLED = "cancelled"

MEMBER_INVITED = "invited"
MEMBER_GOING = "going"
MEMBER_DECLINED = "declined"

# Respuestas que una persona invitada puede dar.
RESPONSES = (MEMBER_GOING, MEMBER_DECLINED)

MAX_TITLE_LENGTH = 80
MAX_NOTE_LENGTH = 500
# Tope de integrantes (incluida la persona creadora) e invitaciones por petición.
MAX_MEMBERS = 20
MAX_INVITES_PER_REQUEST = 19
# El plan debe ser a futuro y no más lejos de un año.
MAX_DAYS_AHEAD = 365

SCOPE_UPCOMING = "upcoming"
SCOPE_PAST = "past"
SCOPES = (SCOPE_UPCOMING, SCOPE_PAST)
MAX_LIST = 50
MAX_FRIENDS_LISTED = 200
