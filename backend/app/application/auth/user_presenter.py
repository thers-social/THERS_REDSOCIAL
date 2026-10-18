# Forma pública compartida del objeto `user` devuelto por register/login/me
# (API_CONTRACT.md §5) -- centralizada acá para no duplicarla en los tres
# casos de uso (ADR-002 — docs/architecture/ADR-002-user-profile-fields.md).
# Nunca incluye password/password_hash/confirm_password/token/secret.
#
# followers_count/following_count (ADR-007-follows-minimal-model.md):
# defaults en 0 -- un usuario recién registrado no tiene seguidores/seguidos
# todavía (register/login no reciben estos contadores, solo GET/PATCH
# /api/users/me los calcula de verdad).
#
# email_verified (ADR-009-password-reset-and-email-verification.md): sí se
# lee directo de `user.email_verified` en los tres casos (a diferencia de
# followers_count/following_count, no requiere una consulta agregada aparte)
# -- una cuenta recién registrada siempre es `False` (DEFAULT false en la
# columna), coherente con que registrarse no verifica el email por sí solo.
#
# profile_completed/has_password (ADR-012-google-sign-in.md): una cuenta
# creada vía "Continuar con Google" puede tener `phone`/`country_code`/
# `birth_date` en `NULL` (Google no los entrega) y ningún `password_hash` --
# `.isoformat()` sobre `birth_date` se guarda con un chequeo explícito para
# no romper con `None`. `profile_completed` es lo que el Frontend usa para
# decidir si redirige a "Complete your profile" (mismo patrón que
# `email_verified` ya usa para redirigir a la verificación de registro).
# `has_password` (derivado, no persiste como tal) le permite al Frontend
# distinguir "cambiar contraseña" de "fijar tu primera contraseña" sin
# adivinarlo -- nunca se expone `password_hash` en sí.


from app.application.media.media_url import media_url
from app.application.terms.terms_version import current_terms_version
from app.domain.terms.policy import has_accepted_current_terms


def to_public_user(user, followers_count=0, following_count=0):
    return {
        "id": str(user.id),
        "username": user.username,
        "email": user.email,
        "name": user.name,
        "phone": user.phone,
        "country_code": user.country_code,
        "birth_date": user.birth_date.isoformat() if user.birth_date else None,
        "followers_count": followers_count,
        "following_count": following_count,
        "email_verified": user.email_verified,
        # ADR-022-private-accounts.md. Viaja en el objeto `user` (y no solo en
        # GET /api/users/me/privacy) porque el Frontend lo necesita en cada
        # arranque de sesión para saber si tiene que mostrar la bandeja de
        # solicitudes -- el resto de las preferencias de privacidad no se
        # necesitan hasta abrir Configuración, así que esas sí viven solo en su
        # propio endpoint.
        "is_private": user.is_private,
        "profile_completed": user.profile_completed,
        "has_password": user.password_hash is not None,
        # ADR-032 fase 2: solo para que el cliente decida si muestra la entrada a la
        # página de moderación. No concede nada: las rutas lo vuelven a comprobar.
        "is_moderator": user.is_moderator,
        # ADR-044 §2.5: rol separado (`reviewer`, `child_safety`, `admin`) o null. Igual que
        # `is_moderator`, solo decide qué secciones ofrece el panel; el servidor lo comprueba.
        "moderation_role": user.moderation_role,
        # ADR-032 §5: `true` solo si aceptó la versión VIGENTE. Las cuentas
        # anteriores y las que aceptaron una versión vieja dan `false`, y el
        # cliente les pide aceptar antes de crear contenido.
        "terms_accepted": has_accepted_current_terms(
            user.terms_version, current_terms_version()
        ),
        # ADR-015-profile-media.md: perfil público extendido. `None` = no definido.
        "bio": user.bio,
        "location": user.location,
        "website": user.website,
        "avatar_url": media_url(user.avatar_path),
        "cover_url": media_url(user.cover_path),
    }


def to_author_summary(user):
    """Forma reducida del autor que comparten posts/comentarios/mensajes
    (nunca campos privados). Centraliza `avatar_url` (ADR-015)."""
    return {
        "id": str(user.id),
        "username": user.username,
        "name": user.name,
        "avatar_url": media_url(user.avatar_path),
    }
