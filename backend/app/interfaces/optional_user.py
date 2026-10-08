# Identidad OPCIONAL para rutas públicas que cambian un poco si hay sesión (p. ej. el
# catálogo de lugares marca `is_saved`).
#
# Un token ausente, vencido, revocado o inválido se trata como "anónimo" y NO como un
# error: en un catálogo público, un token vencido en la app no debe impedir ver los
# lugares. Las rutas que SÍ exigen sesión usan `@jwt_required()` y responden 401.

from flask_jwt_extended import get_jwt_identity, verify_jwt_in_request
from flask_jwt_extended.exceptions import JWTExtendedException
from jwt.exceptions import PyJWTError


def optional_user_id():
    """Id de la persona autenticada, o `None` si es anónima o su token no vale."""
    try:
        verify_jwt_in_request(optional=True)
    except (JWTExtendedException, PyJWTError):
        return None
    return get_jwt_identity()
