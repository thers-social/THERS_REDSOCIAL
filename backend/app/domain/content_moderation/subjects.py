# Qué tipos de contenido pasan por la moderación (ADR-044). Solo tipos nativos.
#
# Un trabajo y una apelación guardan `subject_type`: una cadena, sin clave foránea (el sujeto vive
# en tablas distintas). Esta lista es CERRADA: un tipo que no esté aquí nunca llega a una consulta,
# así que el nombre de tabla que usan los repositorios no puede venir de una entrada externa.

MEDIA_ATTACHMENT = "media_attachment"
STORY = "story"

ALL = (MEDIA_ATTACHMENT, STORY)

#: Valor de `?type=` en las rutas del panel -> tipo de contenido.
FROM_QUERY = {"media": MEDIA_ATTACHMENT, "story": STORY}


def parse(value, default=MEDIA_ATTACHMENT):
    """Tipo de contenido para un `?type=` del panel, o `None` si no es uno conocido."""
    if value is None or value == "":
        return default
    return FROM_QUERY.get(value)


def is_known(subject_type):
    return subject_type in ALL
