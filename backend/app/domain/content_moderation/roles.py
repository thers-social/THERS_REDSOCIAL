# Roles separados de moderación (ADR-044 §2.5). Solo tipos nativos.
#
#   reviewer      revisa la cola general y resuelve apelaciones de contenido no restringido.
#   child_safety  además atiende la cola restringida (seguridad infantil / ilegal).
#   admin         además ve la auditoría, los trabajos fallidos y las estadísticas completas.
#
# `users.is_moderator` se conserva por compatibilidad y equivale a `reviewer`.

REVIEWER = "reviewer"
CHILD_SAFETY = "child_safety"
ADMIN = "admin"

ALL = (REVIEWER, CHILD_SAFETY, ADMIN)

#: Roles que pueden ver y decidir el contenido restringido. Los moderadores comunes NO
#: revisan material sospechoso de abuso infantil (ADR-044 §2.5).
CAN_SEE_RESTRICTED = (CHILD_SAFETY, ADMIN)


def effective_role(is_moderator, moderation_role, suspended):
    """Rol efectivo, o `None` si no modera. Una cuenta suspendida no conserva el rol."""
    if suspended:
        return None
    if moderation_role in ALL:
        return moderation_role
    return REVIEWER if is_moderator else None


def can_see_restricted(role):
    return role in CAN_SEE_RESTRICTED
