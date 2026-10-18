# GET /api/users/me (ADR-002 §3 — docs/architecture/ADR-002-user-profile-fields.md)
# y PATCH /api/users/me (ADR-003 — docs/architecture/ADR-003-profile-update-contract.md).
# Blueprint separado de auth_bp: no es un endpoint de autenticación en sí
# (no emite ni valida credenciales), es el primer endpoint protegido del
# backend (@jwt_required()) -- BACKEND_ARCHITECTURE.md §9/§14 señalaba que
# no existía todavía ningún caso real de "endpoint protegido" que fijara el
# patrón; este archivo lo fija.
#
# Composition root igual que auth_routes.py (BACKEND_ARCHITECTURE.md §17):
# único punto que conoce tanto el caso de uso (application/) como la
# implementación concreta del repositorio (infrastructure/).

from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.application.auth.get_current_user_use_case import get_current_user
from app.application.auth.update_profile_media_use_case import (
    remove_profile_image,
    set_profile_image,
)
from app.application.auth.get_public_profile_use_case import get_public_profile
from app.application.auth.update_profile_use_case import update_profile
from app.domain.auth.exceptions import (
    UserNotFoundError,
    UsernameAlreadyExistsError,
    UsernameChangeNotAllowedError,
)
from app.domain.auth.validators import (
    MIN_AGE_YEARS,
    is_valid_country_code,
    is_valid_phone,
    is_valid_username,
    is_valid_website,
    meets_minimum_age,
    parse_birth_date,
)
from app.domain.media.storage import ImageTooLargeError, InvalidImageError
from app.infrastructure.media.image_processor import process_image
from app.infrastructure.persistence.repositories.follow_repository import (
    SQLAlchemyFollowRepository,
)
from app.infrastructure.persistence.repositories.restriction_repository import (
    SQLAlchemyRestrictionRepository,
)
from app.infrastructure.persistence.repositories.user_repository import (
    SQLAlchemyUserRepository,
)

users_bp = Blueprint("users", __name__)

_user_repository = SQLAlchemyUserRepository()
_follow_repository = SQLAlchemyFollowRepository()
_restriction_repository = SQLAlchemyRestrictionRepository()
# POST /api/send-verification-email (protegido, JWT) se retiró en
# ADR-011-mandatory-email-verification.md: con la verificación obligatoria
# al registrarse (ADR-011), una cuenta sin verificar nunca puede obtener un
# JWT (login_use_case.py la bloquea) -- este endpoint habría quedado
# inalcanzable en la práctica. El reenvío de código ahora es público
# (POST /api/resend-registration-code, auth_routes.py), igual que
# "Reenviar código" de recuperación de contraseña.

# Whitelist de campos editables por PATCH /api/users/me (ADR-003 §Campos
# editables). La ruta extrae cada campo explícitamente de `data.get(...)` --
# nunca `**data`, nunca se pasa el body directo al caso de uso/repositorio
# (ADR-003 §Seguridad: defensa concreta contra mass assignment/overposting).
_MAX_NAME_LENGTH = 120
# ADR-015-profile-media.md: texto opcional del perfil; cadena vacía = borrar (NULL).
_TEXT_LIMITS = {"bio": 160, "location": 60, "website": 100}


@users_bp.route("/users/me", methods=["GET"])
@jwt_required()
def me():
    # La identidad viene exclusivamente del JWT (get_jwt_identity()) -- nunca
    # de query string, body ni headers personalizados (ADR-002 §3).
    user_id = get_jwt_identity()

    try:
        user = get_current_user(user_id, _user_repository, _follow_repository)
    except UserNotFoundError:
        return jsonify({"msg": "Usuario no encontrado"}), 404

    return jsonify({"user": user}), 200


@users_bp.route("/users/<uuid:user_id>", methods=["GET"])
@jwt_required()
def public_profile(user_id):
    """Perfil de otra persona (ADR-049). Una cuenta bloqueada en cualquier sentido es 404."""
    try:
        profile = get_public_profile(
            str(user_id), get_jwt_identity(), _user_repository, _follow_repository,
            _restriction_repository,
        )
    except UserNotFoundError:
        return jsonify({"msg": "Usuario no encontrado"}), 404

    return jsonify({"user": profile}), 200


@users_bp.route("/users/me", methods=["PATCH"])
@jwt_required()
def update_me():
    # Identidad exclusivamente del JWT -- nunca de query string, body ni
    # headers personalizados (ADR-003 §Seguridad, mismo principio que /me).
    user_id = get_jwt_identity()

    data = request.get_json(silent=True)
    if not data:
        return jsonify({"msg": "No se recibió ningún campo para actualizar"}), 400

    fields = {}

    if "name" in data:
        name = data.get("name")
        if not isinstance(name, str) or not name.strip():
            return jsonify({"msg": "El nombre no puede estar vacío"}), 400
        if len(name.strip()) > _MAX_NAME_LENGTH:
            return jsonify({"msg": "El nombre no puede superar 120 caracteres"}), 400
        fields["name"] = name.strip()

    if "username" in data:
        username = data.get("username")
        if not isinstance(username, str) or not is_valid_username(username):
            return jsonify(
                {"msg": "El username debe tener 3 a 20 caracteres alfanuméricos o guion bajo"}
            ), 400
        fields["username"] = username

    # phone/country_code representan un único dato lógico (ADR-003 §Reglas
    # de validación): si uno llega, el otro debe llegar también.
    phone_present = "phone" in data
    country_code_present = "country_code" in data
    if phone_present != country_code_present:
        return jsonify(
            {"msg": "El teléfono y el código de país deben enviarse juntos"}
        ), 400
    if phone_present and country_code_present:
        phone = data.get("phone")
        country_code = data.get("country_code")
        if not isinstance(phone, str) or not is_valid_phone(phone):
            return jsonify({"msg": "El teléfono no es válido"}), 400
        if not isinstance(country_code, str) or not is_valid_country_code(country_code):
            return jsonify({"msg": "El código de país no es válido"}), 400
        fields["phone"] = phone
        fields["country_code"] = country_code

    if "birth_date" in data:
        birth_date_raw = data.get("birth_date")
        birth_date = parse_birth_date(birth_date_raw) if isinstance(birth_date_raw, str) else None
        if birth_date is None:
            return jsonify({"msg": "La fecha de nacimiento no es válida"}), 400
        if not meets_minimum_age(birth_date):
            return jsonify({
                "msg": f"THERS es solo para personas de {MIN_AGE_YEARS} años o más",
                "min_age": MIN_AGE_YEARS,
            }), 400
        fields["birth_date"] = birth_date

    for field, limit in _TEXT_LIMITS.items():
        if field not in data:
            continue
        value = data.get(field)
        if value is None:
            fields[field] = None
            continue
        if not isinstance(value, str):
            return jsonify({"msg": f"El campo {field} no es válido"}), 400
        value = value.strip()
        if len(value) > limit:
            return jsonify({"msg": f"El campo {field} no puede superar {limit} caracteres"}), 400
        if field == "website" and value and not is_valid_website(value):
            return jsonify({"msg": "El sitio web no es válido"}), 400
        fields[field] = value or None

    if not fields:
        return jsonify({"msg": "No se recibió ningún campo para actualizar"}), 400

    try:
        user = update_profile(user_id, fields, _user_repository, _follow_repository)
    except UserNotFoundError:
        return jsonify({"msg": "Usuario no encontrado"}), 404
    except UsernameAlreadyExistsError:
        return jsonify({"msg": "Ya existe una cuenta con ese username"}), 409
    except UsernameChangeNotAllowedError:
        return jsonify(
            {"msg": "Solo puedes cambiar tu username una vez cada 30 días"}
        ), 400

    return jsonify({"user": user}), 200


# --- Foto de perfil y portada (ADR-015-profile-media.md) ---
# multipart/form-data con el campo `file`. Identidad solo del JWT.

def _upload_image(kind):
    user_id = get_jwt_identity()
    upload = request.files.get("file")
    if upload is None:
        return jsonify({"msg": "No se recibió ninguna imagen"}), 400

    try:
        user = set_profile_image(
            user_id,
            kind,
            upload.read(),
            process_image,
            current_app.extensions["media_storage"],
            _user_repository,
            _follow_repository,
        )
    except InvalidImageError:
        return jsonify({"msg": "El archivo debe ser una imagen JPEG, PNG o WebP válida"}), 400
    except ImageTooLargeError:
        return jsonify({"msg": "La imagen no puede superar 5 MB"}), 413
    except UserNotFoundError:
        return jsonify({"msg": "Usuario no encontrado"}), 404

    return jsonify({"user": user}), 200


def _delete_image(kind):
    try:
        user = remove_profile_image(
            get_jwt_identity(),
            kind,
            current_app.extensions["media_storage"],
            _user_repository,
            _follow_repository,
        )
    except UserNotFoundError:
        return jsonify({"msg": "Usuario no encontrado"}), 404
    return jsonify({"user": user}), 200


@users_bp.route("/users/me/avatar", methods=["POST"])
@jwt_required()
def upload_avatar():
    return _upload_image("avatar")


@users_bp.route("/users/me/avatar", methods=["DELETE"])
@jwt_required()
def delete_avatar():
    return _delete_image("avatar")


@users_bp.route("/users/me/cover", methods=["POST"])
@jwt_required()
def upload_cover():
    return _upload_image("cover")


@users_bp.route("/users/me/cover", methods=["DELETE"])
@jwt_required()
def delete_cover():
    return _delete_image("cover")
