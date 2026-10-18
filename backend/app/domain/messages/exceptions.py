# Excepciones de dominio para `messages` (ADR-013-messages-minimal-model.md).
# El caso "usuario destinatario no existe" reutiliza UserNotFoundError
# (domain/auth/exceptions.py) -- mismo caso que ya cubre follows/GET
# /api/users/me, no se duplica una excepción equivalente acá.


class CannotMessageSelfError(Exception):
    """Se intentó mandar un mensaje a sí mismo -- `user_id` de la URL
    coincide con `get_jwt_identity()`. Impuesto también a nivel de esquema
    (CHECK ck_messages_no_self_message, ADR-013 §Modelo de datos) -- esta
    excepción es la primera línea de defensa, con un mensaje claro."""


class MessageNotFoundError(Exception):
    """`message_id` no existe, o existe pero no pertenece a quien intenta
    borrarlo (ADR-014-messages-ux-improvements.md) -- mismo mensaje/código
    en ambos casos, no se distingue cuál ocurrió."""


class MessagesNotAllowedError(Exception):
    """El destinatario no acepta mensajes de quien escribe, segun su
    preferencia `who_can_message`
    (ADR-024-content-filters-and-privacy-preferences.md).

    La route lo traduce a **403, no a 404**: a diferencia de una cuenta
    privada (ADR-022), aca no hay nada que ocultar -- quien escribe ya sabia
    que esa persona existe (le estaba escribiendo) y mentirle con un 404 solo
    lo haria reintentar. Lo que la preferencia protege es la bandeja, no la
    existencia de la cuenta."""


class SharedPostNotFoundError(Exception):
    """La publicación que se quiere compartir no existe o quien comparte no puede verla (ADR-047)."""


class SharedPlaceNotFoundError(Exception):
    """El lugar que se quiere compartir no existe o no es público (ADR-040 fase 4c)."""
