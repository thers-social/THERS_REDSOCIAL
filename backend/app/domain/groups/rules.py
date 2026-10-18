# Reglas puras de los chats grupales (ADR-048). Sin Flask ni SQLAlchemy.

MAX_MEMBERS = 50
MAX_NAME_LENGTH = 60
ADMIN = "admin"
MEMBER = "member"


def clean_name(value):
    """Nombre del grupo sin espacios sobrantes, o None si no es válido (vacío o demasiado largo)."""
    if not isinstance(value, str):
        return None
    name = " ".join(value.split())
    return name if 0 < len(name) <= MAX_NAME_LENGTH else None
