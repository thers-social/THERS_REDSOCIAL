# Estados de moderación del contenido multimedia (ADR-044 §2.1). Solo tipos nativos: domain/ no
# importa Flask ni SQLAlchemy (BACKEND_ARCHITECTURE.md §7/§17).

PENDING = "pending"
APPROVED = "approved"
HELD = "held"
REJECTED = "rejected"

ALL = (PENDING, APPROVED, HELD, REJECTED)

#: Lo que el motor automático puede decidir. NUNCA `rejected` (ADR-044 decisión 2).
AUTOMATIC = (APPROVED, HELD)

#: Lo que puede decidir una persona moderadora desde el panel.
HUMAN = (APPROVED, HELD, REJECTED)

ACTOR_AUTO = "auto"
ACTOR_KIND_HUMAN = "human"
ACTOR_KIND_SYSTEM = "system"


def initial_status(moderation_enabled):
    """Estado con el que nace un contenido nuevo. Con la moderación apagada se publica como
    siempre; encendida, espera revisión. La aplicación lo fija SIEMPRE de forma explícita:
    el valor por defecto de la base ('pending') es solo una red de seguridad."""
    return PENDING if moderation_enabled else APPROVED
