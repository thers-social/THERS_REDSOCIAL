# Excepciones de dominio para `follows` (ADR-007-follows-minimal-model.md).
# El caso "usuario objetivo no existe" reutiliza UserNotFoundError
# (domain/auth/exceptions.py) -- mismo caso que ya cubre GET /api/users/me,
# no se duplica una excepción equivalente acá.


class CannotFollowSelfError(Exception):
    """Se intentó seguir a sí mismo -- `user_id` de la URL coincide con
    `get_jwt_identity()`. Impuesto también a nivel de esquema
    (CHECK ck_follows_no_self_follow, ADR-007 §Opciones consideradas) --
    esta excepción es la primera línea de defensa, con un mensaje claro."""


class FollowRequestNotFoundError(Exception):
    """No hay ninguna solicitud de seguimiento pendiente de `follower_id`
    hacia quien intenta responderla -- porque nunca existió, porque ya se
    respondió, o porque está dirigida a otra persona. Los tres casos se
    tratan igual (404, sin distinguir cuál ocurrió): un 403 confirmaría que
    esa solicitud existe y de quién es (ADR-022-private-accounts.md
    §Seguridad, mismo criterio que NotificationNotFoundError)."""


class CannotViewConnectionsError(Exception):
    """La lista de seguidores/seguidos de una cuenta privada que no sigues (ADR-050)."""
