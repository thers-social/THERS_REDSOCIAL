# A quién va dirigida una publicación (ADR-054). Solo tipos nativos: domain/ no importa Flask ni
# SQLAlchemy (BACKEND_ARCHITECTURE.md §7/§17).
#
# `everyone` = quien ya puede ver las publicaciones del autor (cuentas privadas, bloqueos: ADR-022,
# ADR-029); `close_friends` = solo quien además está en su lista de mejores amigos. La pertenencia
# se mira al LEER: quitar a alguien de la lista le quita el acceso a lo ya publicado.

AUDIENCE_EVERYONE = "everyone"
AUDIENCE_CLOSE_FRIENDS = "close_friends"
AUDIENCES = (AUDIENCE_EVERYONE, AUDIENCE_CLOSE_FRIENDS)


class PostAudienceInvalidError(Exception):
    """`audience` no es ninguno de los valores permitidos."""


def normalize_audience(value):
    """`everyone` si no se envía nada; el valor si es válido. Lanza si no lo es."""
    if value is None or value == "":
        return AUDIENCE_EVERYONE
    if value not in AUDIENCES:
        raise PostAudienceInvalidError()
    return value
