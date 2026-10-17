# Herramientas de lectura de Tero (ADR-041 §6.1, fase 5).
#
# Reglas que se cumplen aquí, una por una:
#   1. El modelo NUNCA llama a un repositorio: pide una herramienta por nombre y este módulo decide.
#   2. Cada herramienta llama a un CASO DE USO existente (o a la misma consulta con las mismas
#      reglas de visibilidad que usa la app), con el `user_id` del JWT. Nada de lo que escribe el
#      modelo o el móvil es una identidad: `user_id` no es un argumento de ninguna herramienta.
#   3. Se devuelve lo MÍNIMO: nombre, usuario, texto acotado y contadores. Nunca correo, teléfono,
#      fecha de nacimiento, mensajes directos, ubicación de la persona ni rutas de archivos.
#   4. «No existe» y «no puedes verlo» dan la misma respuesta (`found: false`): una herramienta no
#      es un oráculo para saber qué cuentas privadas o bloqueos existen.
#   5. Todo texto de otras personas (publicaciones, bios) es DATO. Va dentro de un resultado, nunca
#      en las instrucciones, y el prompt de sistema le dice al modelo que no lo obedezca.

from uuid import UUID

from app.application.notifications.list_notifications_use_case import list_notifications
from app.application.places import place_use_cases
from app.application.posts.list_posts_use_case import list_posts
from app.domain.places.exceptions import InvalidPlaceQueryError
from app.domain.tero import tools as tool_rules
from app.domain.tero.tools import ToolSpec

MAX_TEXT = 500
MAX_BIO = 160
MAX_RESULTS = 5


class ToolDependencies:
    """Los repositorios que las herramientas necesitan, inyectados desde la route. Así las pruebas
    pueden reemplazarlos y este módulo no importa infraestructura."""

    def __init__(
        self, user_repository, follow_repository, notification_repository,
        restriction_repository, post_repository, like_repository, comment_repository,
        mention_repository, muted_keyword_repository, place_repository, user_search_repository,
    ):
        self.user_repository = user_repository
        self.follow_repository = follow_repository
        self.notification_repository = notification_repository
        self.restriction_repository = restriction_repository
        self.post_repository = post_repository
        self.like_repository = like_repository
        self.comment_repository = comment_repository
        self.mention_repository = mention_repository
        self.muted_keyword_repository = muted_keyword_repository
        self.place_repository = place_repository
        self.user_search_repository = user_search_repository


def _clip(text, limit):
    if text is None:
        return None
    return text if len(text) <= limit else text[: limit - 1] + "…"


# ---------------------------------------------------------------- profile_read


def _profile_read(user_id, args, deps):
    user = deps.user_repository.find_by_id(user_id)
    if user is None:
        return {"found": False}
    return {
        "found": True,
        "name": user.name,
        "username": user.username,
        "bio": _clip(user.bio, MAX_BIO),
        "is_private": user.is_private,
        "followers_count": deps.follow_repository.followers_count(user_id),
        "following_count": deps.follow_repository.following_count(user_id),
    }


# ------------------------------------------------------- notifications_summary


def _notifications_summary(user_id, args, deps):
    notifications = list_notifications(
        user_id, deps.notification_repository, deps.restriction_repository
    )
    unread = [item for item in notifications if not item["read"]]
    by_type = {}
    for item in unread:
        by_type[item["type"]] = by_type.get(item["type"], 0) + 1
    recent = []
    for item in notifications[:MAX_RESULTS]:
        recent.append(
            {
                "type": item["type"],
                "from": item["actor"]["username"] if item.get("actor") else None,
                "place": item["place"]["name"] if item.get("place") else None,
                "read": item["read"],
                "created_at": item["created_at"],
            }
        )
    # Sin el campo libre `detail`: es texto escrito por otra persona.
    return {"unread_count": len(unread), "unread_by_type": by_type, "recent": recent}


# ----------------------------------------------------------------- users_search


def _users_search(user_id, args, deps):
    users = deps.user_search_repository.search(user_id, args["query"], MAX_RESULTS)
    return {
        "results": [
            {"username": user.username, "name": user.name, "is_private": user.is_private}
            for user in users
        ]
    }


# -------------------------------------------------------------------- post_read


def _post_read(user_id, args, deps):
    posts = list_posts(
        deps.post_repository, deps.like_repository, deps.comment_repository,
        deps.follow_repository, deps.mention_repository, deps.muted_keyword_repository,
        user_id, limit=1, post_id=UUID(args["post_id"]),
    )
    if not posts:
        # No existe, es de una cuenta privada que no sigues, hay un bloqueo o lo tienes filtrado:
        # el modelo no puede distinguirlos.
        return {"found": False}
    post = posts[0]
    return {
        "found": True,
        "author": post["author"]["username"],
        "author_name": post["author"]["name"],
        "content": _clip(post["content"], MAX_TEXT),
        "created_at": post["created_at"],
        "likes_count": post["likes_count"],
        "comments_count": post["comments_count"],
        "is_sensitive": post["is_sensitive"],
        "place": post["place"]["name"] if post.get("place") else None,
    }


# ----------------------------------------------------------------- places_search


def _places_search(user_id, args, deps):
    try:
        places = place_use_cases.search_places(
            args["query"], None, None, args.get("category"), MAX_RESULTS,
            deps.place_repository, user_id,
        )
    except InvalidPlaceQueryError as error:
        raise tool_rules.ToolInputError(error.message) from None
    return {
        "results": [
            {
                "id": place["id"],
                "name": place["name"],
                "category": (place.get("category") or {}).get("name"),
                "address": _clip(place.get("address"), 160),
                "rating_average": place.get("rating_average"),
                "reviews_count": place.get("reviews_count"),
            }
            for place in places
        ]
    }


# -------------------------------------------------------------------- registro


class Tool:
    __slots__ = ("spec", "handler")

    def __init__(self, spec, handler):
        self.spec = spec
        self.handler = handler


_TOOLS = [
    Tool(
        ToolSpec(
            "profile_read",
            "Lee el perfil de la persona que está chateando: nombre, usuario, biografía, si su "
            "cuenta es privada y cuántos seguidores y seguidos tiene. No acepta argumentos.",
        ),
        _profile_read,
    ),
    Tool(
        ToolSpec(
            "notifications_summary",
            "Resume las notificaciones de la persona: cuántas no ha leído, de qué tipos y las "
            "5 más recientes. No acepta argumentos.",
        ),
        _notifications_summary,
    ),
    Tool(
        ToolSpec(
            "users_search",
            "Busca personas de THERS por nombre o nombre de usuario. Devuelve hasta 5 resultados "
            "con usuario y nombre.",
            {"query": tool_rules.string_prop("Texto a buscar (2 a 50 caracteres)", 2, 50)},
            required=("query",),
        ),
        _users_search,
    ),
    Tool(
        ToolSpec(
            "post_read",
            "Lee una publicación por su identificador, solo si la persona puede verla. "
            "Devuelve autor, texto, fecha y contadores.",
            {"post_id": tool_rules.uuid_prop("Identificador (UUID) de la publicación")},
            required=("post_id",),
        ),
        _post_read,
    ),
    Tool(
        ToolSpec(
            "places_search",
            "Busca lugares del catálogo público de THERS Places por nombre. Devuelve hasta 5 "
            "con nombre, categoría, dirección y valoración.",
            {
                "query": tool_rules.string_prop("Texto a buscar (2 a 60 caracteres)", 2, 60),
                "category": tool_rules.string_prop(
                    "Categoría opcional (por ejemplo cafes)", 2, 40
                ),
            },
            required=("query",),
        ),
        _places_search,
    ),
]

REGISTRY = {tool.spec.name: tool for tool in _TOOLS}


def tool_definitions():
    """Lo que se le envía al proveedor."""
    return [tool.spec.to_definition() for tool in _TOOLS]


def run_tool(name, raw_arguments, user_id, deps):
    """Valida y ejecuta. Lanza `ToolInputError` (mensaje seguro de devolver al modelo) o
    `KeyError` si la herramienta no existe. Cualquier otro error lo trata quien llama."""
    tool = REGISTRY[name]
    arguments = tool_rules.validate_arguments(tool.spec, raw_arguments)
    return tool.handler(user_id, arguments, deps)
