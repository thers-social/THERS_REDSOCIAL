from flask import Blueprint, current_app, jsonify, request

from app.application.account_deletion.account_deletion_use_cases import (
    confirm_account_deletion,
    request_account_deletion,
)
from app.application.email.email_service import EmailService
from app.application.rate_limiting import rate_limit_guard
from app.config import Config
from app.domain.account_deletion.exceptions import (
    DeletionConfirmationError,
    InvalidDeletionCodeError,
    TwoFactorRequiredForDeletionError,
)
from app.domain.auth.two_factor_exceptions import InvalidTwoFactorCodeError
from app.domain.auth.validators import is_valid_email
from app.domain.rate_limiting import policy
from app.domain.rate_limiting.exceptions import RateLimitExceededError
from app.infrastructure.auth.pyotp_totp_provider import PyotpTotpProvider
from app.infrastructure.email.factory import create_email_sender
from app.infrastructure.persistence.repositories.account_deletion_repository import (
    SQLAlchemyAccountDeleter,
    SQLAlchemyAccountDeletionCodeRepository,
)
from app.infrastructure.persistence.repositories.rate_limit_repository import (
    SQLAlchemyRateLimitRepository,
)
from app.infrastructure.persistence.repositories.two_factor_recovery_code_repository import (
    SQLAlchemyTwoFactorRecoveryCodeRepository,
)
from app.infrastructure.persistence.repositories.user_repository import SQLAlchemyUserRepository

account_deletion_bp = Blueprint("account_deletion", __name__)

_user_repository = SQLAlchemyUserRepository()
_code_repository = SQLAlchemyAccountDeletionCodeRepository()
_recovery_code_repository = SQLAlchemyTwoFactorRecoveryCodeRepository()
_totp_provider = PyotpTotpProvider()
_rate_limit_repository = SQLAlchemyRateLimitRepository()
_account_deleter = SQLAlchemyAccountDeleter(_rate_limit_repository)
_email_service = EmailService(create_email_sender(Config.RESEND_API_KEY, Config.EMAIL_FROM))


def _client_ip():
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.remote_addr or "unknown"


def _rate_limited_response(error):
    response = jsonify({
        "msg": "Demasiados intentos. Espera un momento antes de volver a probar.",
        "retry_after_seconds": error.retry_after_seconds,
    })
    response.status_code = 429
    response.headers["Retry-After"] = str(error.retry_after_seconds)
    return response


def _clean_email(data):
    email = data.get("email")
    return email.strip() if isinstance(email, str) else email


@account_deletion_bp.route("/account-deletion/request", methods=["POST"])
def request_deletion_route():
    # Público (ADR-031 §Decisión 1): quien lo llama puede no tener sesión (por
    # ejemplo, olvidó la contraseña). La identidad la aporta el control del correo.
    #
    # Límite por IP contando TODAS las llamadas: cada una exitosa manda un correo,
    # así que aquí el éxito ES el abuso (ADR-027, clear_on_success=False).
    try:
        rate_limit_guard.enforce(
            policy.ACCOUNT_DELETION_REQUEST, _client_ip(), _rate_limit_repository
        )
    except RateLimitExceededError as error:
        return _rate_limited_response(error)

    data = request.get_json(silent=True)
    if not data:
        return jsonify({"msg": "No se enviaron datos"}), 400

    email = _clean_email(data)
    if not email:
        return jsonify({"msg": "El email es obligatorio"}), 400
    if not is_valid_email(email):
        return jsonify({"msg": "El email no es válido"}), 400

    result = request_account_deletion(email, _user_repository, _code_repository, _email_service)
    # Siempre 200 con el mismo mensaje: sin enumeración de correos.
    return jsonify(result), 200


@account_deletion_bp.route("/account-deletion/confirm", methods=["POST"])
def confirm_deletion_route():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"msg": "No se enviaron datos"}), 400

    email = _clean_email(data)
    code = data.get("code")
    if not email or not is_valid_email(email):
        return jsonify({"msg": "El email no es válido"}), 400
    if not code or not isinstance(code, str):
        return jsonify({"msg": "El código es obligatorio"}), 400

    # Por IP y por cuenta (el correo, sin importar si existe: así el límite no
    # revela nada). `clear_on_success=True`: se frena adivinar, no usar. Cubre
    # tanto el código de 6 dígitos como el segundo factor.
    account_identity = f"account-deletion:{email.lower()}"
    ip_identity = f"ip:{_client_ip()}"
    try:
        rate_limit_guard.enforce(
            policy.ACCOUNT_DELETION_CONFIRM, account_identity, _rate_limit_repository
        )
        rate_limit_guard.enforce(
            policy.ACCOUNT_DELETION_CONFIRM, ip_identity, _rate_limit_repository
        )
    except RateLimitExceededError as error:
        return _rate_limited_response(error)

    try:
        result = confirm_account_deletion(
            email,
            code,
            data.get("confirm_email"),
            data.get("confirmation"),
            data.get("two_factor_code"),
            _user_repository,
            _code_repository,
            _recovery_code_repository,
            _totp_provider,
            _account_deleter,
            current_app.extensions["media_storage"],
            _email_service,
            current_app.extensions.get("private_storage"),
        )
    except InvalidDeletionCodeError:
        # Mismo mensaje para cuenta inexistente, sin solicitud, vencido, agotado
        # o incorrecto (ADR-031 §Seguridad).
        return jsonify({"msg": "El código es incorrecto o venció. Pide uno nuevo."}), 400
    except DeletionConfirmationError:
        return jsonify({
            "msg": "Escribe tu correo y la palabra DELETE exactamente como se indica.",
            "confirmation_error": True,
        }), 400
    except TwoFactorRequiredForDeletionError:
        # Solo con el código de correo ya verificado y sin consumirlo.
        return jsonify({
            "msg": "Tu cuenta tiene verificación en dos pasos. Ingresa tu código.",
            "two_factor_required": True,
        }), 403
    except InvalidTwoFactorCodeError:
        # 400 y no 401: un 401 en un cliente con sesión dispara su renovación y
        # puede cerrarla; aquí el error es solo un dato incorrecto.
        return jsonify({"msg": "El código de verificación en dos pasos no es válido."}), 400

    rate_limit_guard.clear(policy.ACCOUNT_DELETION_CONFIRM, account_identity, _rate_limit_repository)
    rate_limit_guard.clear(policy.ACCOUNT_DELETION_CONFIRM, ip_identity, _rate_limit_repository)
    return jsonify(result), 200
