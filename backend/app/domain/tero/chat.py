# Reglas del chat de Tero (ADR-041 §3, §5). Solo tipos nativos de Python: domain/ no importa
# Flask ni SQLAlchemy (BACKEND_ARCHITECTURE.md §7/§17).
#
# Lo que llega del móvil es DATO, nunca confianza: se valida la forma y el tamaño, y nada de lo
# que diga el cliente amplía permisos. `entity_id` se valida pero en la fase 4 NO viaja al
# modelo (no hay herramientas todavía); en la fase 5 se revalidará contra los permisos reales.

import base64
import binascii
import re

MAX_MESSAGE_LENGTH = 1000
MAX_HISTORY_TURNS = 10
MAX_REPLY_LENGTH = 4000
MAX_OUTPUT_TOKENS = 1024

# Imagen adjunta a una pregunta (ADR-046): UNA por petición, en base64 dentro del JSON. El cliente la
# reduce antes de enviarla; el servidor la vuelve a decodificar por su contenido (nunca se fía de lo
# que diga el cliente) y NO la guarda: va al modelo y se descarta.
IMAGE_MEDIA_TYPES = ("image/jpeg", "image/png", "image/webp")
MAX_IMAGE_BYTES = 4 * 1024 * 1024
#: Con imagen y sin texto, Tero responde a esto.
DEFAULT_IMAGE_QUESTION = "¿Qué ves en esta imagen?"

ENTITY_TYPES = ("post", "profile", "place")
_SCREEN = re.compile(r"^[a-z0-9_/\-\[\]]{1,40}$")
_ENTITY_ID = re.compile(r"^[A-Za-z0-9_\-]{1,64}$")
ROLES = ("user", "assistant")

# `source` de la respuesta: de dónde salió el texto. El cliente puede distinguir una respuesta
# del modelo de un texto fijo del sistema.
SOURCE_AI = "ai"
SOURCE_DISABLED = "disabled"
SOURCE_BUDGET = "budget"
SOURCE_REFUSED = "refused"

DISABLED_REPLY = "Tero todavía no puede responder preguntas. Pronto estará listo."
BUDGET_REPLY = "Tero descansa hasta el próximo mes. Mientras tanto puedes seguir usando THERS."
REFUSED_REPLY = "No puedo ayudarte con eso, pero puedes preguntarme otra cosa."


class InvalidTeroRequestError(Exception):
    def __init__(self, message):
        super().__init__(message)
        self.message = message


class TeroUnavailableError(Exception):
    """El proveedor falló, venció el tiempo o no está configurado. Nunca lleva el texto del
    proveedor: la respuesta pública es siempre un mensaje fijo."""


class ChatRequest:
    __slots__ = ("message", "history", "screen", "entity_type", "entity_id", "image")

    def __init__(self, message, history, screen, entity_type, entity_id, image=None):
        # `image`: bytes de la imagen adjunta (sin procesar) o `None`.
        self.image = image
        self.message = message
        self.history = history
        self.screen = screen
        self.entity_type = entity_type
        self.entity_id = entity_id


def _parse_text(value, label):
    if not isinstance(value, str):
        raise InvalidTeroRequestError(f"{label} debe ser texto")
    text = value.strip()
    if not text:
        raise InvalidTeroRequestError(f"{label} no puede estar vacío")
    if len(text) > MAX_MESSAGE_LENGTH:
        raise InvalidTeroRequestError(
            f"{label} no puede superar {MAX_MESSAGE_LENGTH} caracteres"
        )
    return text


def _parse_history(raw):
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise InvalidTeroRequestError("history debe ser una lista")
    if len(raw) > MAX_HISTORY_TURNS:
        raise InvalidTeroRequestError(f"history admite como máximo {MAX_HISTORY_TURNS} mensajes")
    turns = []
    for item in raw:
        if not isinstance(item, dict) or item.get("role") not in ROLES:
            raise InvalidTeroRequestError("Cada mensaje de history necesita un role válido")
        turns.append({"role": item["role"], "content": _parse_text(item.get("content"), "content")})
    if turns and turns[0]["role"] != "user":
        raise InvalidTeroRequestError("history debe empezar con un mensaje del usuario")
    return turns


def _parse_context(raw):
    if raw is None:
        return None, None, None
    if not isinstance(raw, dict):
        raise InvalidTeroRequestError("context debe ser un objeto")
    screen = raw.get("screen")
    if screen is not None and (not isinstance(screen, str) or not _SCREEN.match(screen)):
        raise InvalidTeroRequestError("context.screen no es válido")
    entity_type = raw.get("entity_type")
    if entity_type is not None and entity_type not in ENTITY_TYPES:
        raise InvalidTeroRequestError("context.entity_type no es válido")
    entity_id = raw.get("entity_id")
    if entity_id is not None:
        if entity_type is None:
            raise InvalidTeroRequestError("context.entity_id necesita entity_type")
        if not isinstance(entity_id, str) or not _ENTITY_ID.match(entity_id):
            raise InvalidTeroRequestError("context.entity_id no es válido")
    return screen, entity_type, entity_id


def _parse_image(raw):
    """Bytes de la imagen adjunta o `None`. Solo valida la forma; decodificarla es de la capa de
    infraestructura (por contenido)."""
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise InvalidTeroRequestError("image debe ser un objeto")
    if raw.get("media_type") not in IMAGE_MEDIA_TYPES:
        raise InvalidTeroRequestError("image.media_type debe ser JPEG, PNG o WebP")
    encoded = raw.get("data")
    if not isinstance(encoded, str) or not encoded:
        raise InvalidTeroRequestError("image.data debe ser texto en base64")
    # Tope sobre el texto, antes de decodificar nada (4/3 del binario).
    if len(encoded) > MAX_IMAGE_BYTES * 4 // 3 + 8:
        raise InvalidTeroRequestError("La imagen pesa demasiado")
    try:
        data = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        raise InvalidTeroRequestError("image.data no es base64 válido") from None
    if not data or len(data) > MAX_IMAGE_BYTES:
        raise InvalidTeroRequestError("La imagen pesa demasiado")
    return data


def parse_chat_request(data):
    if not isinstance(data, dict):
        raise InvalidTeroRequestError("Se esperaba un objeto JSON")
    image = _parse_image(data.get("image"))
    message_raw = data.get("message")
    # Con imagen el texto es opcional: sin él, Tero la describe.
    if image is not None and (message_raw is None or (isinstance(message_raw, str) and not message_raw.strip())):
        message = DEFAULT_IMAGE_QUESTION
    else:
        message = _parse_text(message_raw, "message")
    history = _parse_history(data.get("history"))
    screen, entity_type, entity_id = _parse_context(data.get("context"))
    return ChatRequest(message, history, screen, entity_type, entity_id, image)
