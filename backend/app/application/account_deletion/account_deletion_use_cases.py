# Casos de uso de la eliminación de cuenta (ADR-031-account-deletion.md).
#
# Dos pasos, públicos (sin JWT): la identidad la aporta el control del correo de
# la cuenta (código de 6 dígitos) y, si la cuenta tiene 2FA, el segundo factor.
# Funciona igual para cuentas creadas solo con Google, que no tienen contraseña
# (ADR-012), y para quien olvidó la contraseña.
#
# Tratamiento de datos (ADR-031 §Decisiones del equipo, C -- ver la corrección
# de este documento sobre mensajes): se borra la fila de `users` y, por CASCADE,
# todo lo que depende de ella, incluidos los mensajes enviados y recibidos.
# Quien tenía una conversación con esa cuenta deja de encontrarla ("Usuario no
# encontrado"). Quedan fuera de esta transacción, y se declaran en la política de
# privacidad: las copias de seguridad del proveedor de base de datos y los
# registros del servidor.

import logging
from datetime import datetime, timedelta, timezone

from app.application.two_factor.two_factor_use_case import verify_two_factor_challenge
from app.domain.account_deletion.exceptions import (
    DeletionConfirmationError,
    InvalidDeletionCodeError,
    TwoFactorRequiredForDeletionError,
)
from app.domain.account_deletion.policy import (
    ACCOUNT_DELETION_CODE_TTL_MINUTES,
    ACCOUNT_DELETION_CONFIRMATION_WORD,
    ACCOUNT_DELETION_MAX_ATTEMPTS,
    ACCOUNT_DELETION_REQUEST_COOLDOWN_SECONDS,
)
from app.domain.auth.auth_service import hash_password, verify_password
from app.domain.auth.token_generator import generate_otp_code

_logger = logging.getLogger(__name__)

GENERIC_MESSAGE = (
    "Si existe una cuenta asociada a ese correo, enviaremos un código de confirmación."
)


def request_account_deletion(email, user_repository, code_repository, email_service):
    """Envía el código de confirmación. Responde siempre lo mismo, exista o no
    la cuenta, esté o no en cooldown (sin enumeración de correos)."""
    user = user_repository.find_by_email(email)

    if user is not None and not code_repository.has_recent_unused_code(
        user.id, ACCOUNT_DELETION_REQUEST_COOLDOWN_SECONDS
    ):
        code = generate_otp_code()
        # scrypt, no SHA-256: seis dígitos son 10^6 combinaciones y un hash
        # rápido no protegería nada si la tabla se filtra (ADR-010 §Seguridad).
        code_hash = hash_password(code)
        expires_at = datetime.now(timezone.utc) + timedelta(
            minutes=ACCOUNT_DELETION_CODE_TTL_MINUTES
        )
        code_repository.create_code(user.id, code_hash, expires_at)
        email_service.send_account_deletion_code_email(
            user.email, user.name, code, ACCOUNT_DELETION_CODE_TTL_MINUTES
        )

    return {"msg": GENERIC_MESSAGE}


def confirm_account_deletion(
    email,
    code,
    confirm_email,
    confirmation,
    two_factor_code,
    user_repository,
    code_repository,
    recovery_code_repository,
    totp_provider,
    account_deleter,
    media_storage,
    email_service,
    private_storage=None,
):
    user = user_repository.find_by_email(email)
    if user is None:
        raise InvalidDeletionCodeError()

    row = code_repository.find_active_by_user_id(user.id)
    if row is None:
        raise InvalidDeletionCodeError()

    if row.expires_at <= datetime.now(timezone.utc):
        raise InvalidDeletionCodeError()

    if row.attempts >= ACCOUNT_DELETION_MAX_ATTEMPTS:
        # Intentos agotados: ni siquiera se compara. Quedó inutilizable.
        raise InvalidDeletionCodeError()

    if not verify_password(code, row.code_hash):
        code_repository.increment_attempts(row.id)
        raise InvalidDeletionCodeError()

    # ── A partir de aquí el código de correo es correcto ───────────────────
    # Los errores siguientes ya pueden ser específicos: quien llegó hasta acá
    # controla el correo, así que decirle "falta el 2FA" no revela nada nuevo.

    # La palabra y el correo se escriben a mano en la interfaz: son fricción
    # deliberada contra un clic distraído. Un error NO consume el código.
    if (
        not isinstance(confirmation, str)
        or confirmation != ACCOUNT_DELETION_CONFIRMATION_WORD
        or not isinstance(confirm_email, str)
        or confirm_email.strip().lower() != user.email.lower()
    ):
        raise DeletionConfirmationError()

    if user.two_factor_enabled:
        if not two_factor_code or not isinstance(two_factor_code, str):
            raise TwoFactorRequiredForDeletionError()
        # Lanza InvalidTwoFactorCodeError (lo traduce la route); no consume el
        # código de correo, que sigue sirviendo para reintentar.
        verify_two_factor_challenge(
            user, two_factor_code, user_repository, recovery_code_repository, totp_provider
        )

    # Consumir primero: dos confirmaciones simultáneas no pueden eliminar dos
    # veces. Si ya la consumió la otra, esta falla como un código inválido.
    if not code_repository.mark_used(row.id):
        raise InvalidDeletionCodeError()

    to_email, name = user.email, user.name
    result = account_deleter.delete_account(user.id)

    # Después de confirmar la transacción: si falla el almacenamiento, la
    # eliminación NO se revierte (ADR-031 §Decisión 2). Se registra la clave
    # huérfana -- un nombre de objeto aleatorio, sin datos personales.
    for key in result["media_keys"]:
        try:
            media_storage.delete(key)
        except Exception:  # noqa: BLE001 -- limpieza best-effort
            _logger.warning("Archivo huérfano tras eliminar una cuenta: %s", key)

    if private_storage is not None:
        for key in result.get("private_keys", []):
            try:
                private_storage.delete(key)
            except Exception:  # noqa: BLE001 -- limpieza best-effort
                _logger.warning("Documento privado huérfano tras eliminar una cuenta: %s", key)

    # Confirmación a la dirección de la cuenta, sin guardar copia del correo ni
    # del nombre. Un fallo de envío no deshace una eliminación ya hecha.
    try:
        email_service.send_account_deleted_email(to_email, name)
    except Exception:  # noqa: BLE001
        _logger.warning("No se pudo enviar la confirmación de cuenta eliminada")

    return {"msg": "Tu cuenta fue eliminada."}
