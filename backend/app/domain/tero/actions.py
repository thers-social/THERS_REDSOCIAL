# Acciones con confirmación de Tero (ADR-041 §6.2). Solo tipos nativos de Python: domain/ no
# importa Flask ni SQLAlchemy.
#
# Patrón obligatorio (el modelo NUNCA ejecuta nada):
#   1. el modelo PROPONE (herramienta `propose_*`) -> el servidor valida y guarda una acción
#      pendiente con vencimiento y devuelve una tarjeta de confirmación;
#   2. la persona confirma o cancela con una llamada aparte, que revalida dueño, estado y
#      vencimiento y recién entonces ejecuta el caso de uso existente (idempotente).
#
# Alcance: solo estas tres acciones. Quedan FUERA, por decisión del ADR: contraseña, correo, 2FA,
# borrado de cuenta, bloqueo y cualquier acción de moderación. «Guardar publicación» tampoco está
# porque la app no tiene esa función (no se inventa).

PENDING = "pending"
CONFIRMED = "confirmed"
CANCELLED = "cancelled"
FAILED = "failed"

KIND_FOLLOW = "follow_user"
KIND_UNFOLLOW = "unfollow_user"
KIND_UPDATE_PROFILE = "update_profile"
# Reservar en un lugar (ADR-053): crea una SOLICITUD de reserva, que el lugar confirma o rechaza.
KIND_RESERVE_PLACE = "reserve_place"
KINDS = (KIND_FOLLOW, KIND_UNFOLLOW, KIND_UPDATE_PROFILE, KIND_RESERVE_PLACE)

#: Cuánto vive una propuesta sin respuesta. Corto a propósito: una tarjeta olvidada no debe poder
#: ejecutarse horas después, cuando la persona ya no recuerda qué aprobaba.
EXPIRY_MINUTES = 10

#: Propuestas pendientes a la vez por persona: evita llenar la tabla o la pantalla de tarjetas.
MAX_PENDING_PER_USER = 5

MAX_NAME_LENGTH = 120
MAX_BIO_LENGTH = 160


class ActionNotFoundError(Exception):
    """No existe o NO es de quien pregunta: las dos cosas dan lo mismo (404), para no revelar qué
    ids existen."""


class ActionExpiredError(Exception):
    pass


class ActionNotPendingError(Exception):
    """Ya se resolvió de una forma incompatible (p. ej. confirmar algo cancelado)."""

    def __init__(self, status):
        super().__init__(status)
        self.status = status


class ActionExecutionError(Exception):
    """La acción se aprobó pero ya no se puede ejecutar (p. ej. la cuenta fue bloqueada). El
    mensaje es fijo y seguro de mostrar."""


class InvalidActionError(Exception):
    """La propuesta del modelo no es válida. El mensaje se devuelve al modelo para que corrija."""

    def __init__(self, message):
        super().__init__(message)
        self.message = message


class TooManyPendingActionsError(Exception):
    pass


def clean_profile_changes(arguments):
    """Solo `name` y `bio`. Devuelve `{campo: valor}` o lanza `InvalidActionError`.

    `bio` vacío significa «borrar la biografía» (igual que `PATCH /api/users/me`). Nada más es
    editable desde Tero: ni usuario, ni teléfono, ni fecha de nacimiento, ni privacidad."""
    changes = {}
    if "name" in arguments:
        name = arguments["name"]
        if not isinstance(name, str) or not name.strip():
            raise InvalidActionError("name no puede estar vacío")
        if len(name.strip()) > MAX_NAME_LENGTH:
            raise InvalidActionError(f"name no puede superar {MAX_NAME_LENGTH} caracteres")
        changes["name"] = name.strip()
    if "bio" in arguments:
        bio = arguments["bio"]
        if not isinstance(bio, str):
            raise InvalidActionError("bio debe ser texto")
        bio = bio.strip()
        if len(bio) > MAX_BIO_LENGTH:
            raise InvalidActionError(f"bio no puede superar {MAX_BIO_LENGTH} caracteres")
        changes["bio"] = bio or None
    if not changes:
        raise InvalidActionError("Indica al menos name o bio")
    return changes
