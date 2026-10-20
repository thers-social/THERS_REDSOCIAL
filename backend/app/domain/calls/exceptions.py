# Excepciones de dominio de las llamadas. «Usuario no existe» y «cuenta bloqueada» reutilizan
# UserNotFoundError / AccountBlockedError, igual que los mensajes.


class CallsDisabledError(Exception):
    """Las llamadas están apagadas (`CALLS_ENABLED`) o falta configurar LiveKit."""


class CannotCallSelfError(Exception):
    """Se intentó llamar a la propia cuenta."""


class CallNotAllowedError(Exception):
    """La persona llamada no acepta mensajes (y por tanto llamadas) de quien llama (`who_can_message`)."""


class UserBusyError(Exception):
    """Quien llama, o la persona llamada, ya está en otra llamada."""


class CallNotFoundError(Exception):
    """La llamada no existe o la persona no participa en ella (mismo 404 en ambos casos)."""


class CallStateError(Exception):
    """La acción no aplica al estado actual (por ejemplo, contestar una llamada que ya terminó)."""
