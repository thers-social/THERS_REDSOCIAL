# Excepciones de dominio de los chats grupales (ADR-048).


class GroupNotFoundError(Exception):
    """El grupo no existe O quien pregunta no es miembro: mismo error en ambos casos, para no
    revelar a un tercero que un grupo existe."""


class NotGroupAdminError(Exception):
    """La acción es de administradores y quien la pide es un miembro normal (403)."""


class GroupFullError(Exception):
    """El grupo llegaría a más de MAX_MEMBERS personas."""


class CannotAddMemberError(Exception):
    """Quien añade no puede escribirle a esa cuenta (bloqueo, o solo acepta mensajes de quien sigue)
    o la cuenta no existe. Un solo error, sin decir cuál: no se filtra un bloqueo."""


class InvalidGroupError(Exception):
    """Datos del grupo no válidos (nombre, o lista de personas vacía)."""
