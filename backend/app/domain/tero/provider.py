# Puerto del proveedor de IA (ADR-041 §3). Cambiar de proveedor es escribir otra clase que
# cumpla esto en infrastructure/ai/; nada más del backend conoce su SDK.
#
# Formato de mensajes del puerto (neutral, el mismo que usan los proveedores principales):
#   {"role": "user"|"assistant", "content": str | [bloque, ...]}
# con bloques `{"type": "text", "text": ...}`, `{"type": "tool_use", "id", "name", "input"}` y
# `{"type": "tool_result", "tool_use_id", "content": str, "is_error"?: bool}`.

from abc import ABC, abstractmethod


class AiProviderError(Exception):
    """Cualquier fallo del proveedor (red, tiempo, cuota, 5xx). El mensaje NUNCA debe llevar el
    texto del proveedor ni datos del usuario: se registra aparte, sin contenido."""


class ToolCall:
    """Una herramienta que el modelo pide ejecutar. `input` es lo que el modelo escribió: DATO sin
    confianza, se valida contra el esquema antes de usarse."""

    __slots__ = ("id", "name", "input")

    def __init__(self, id, name, input):
        self.id = id
        self.name = name
        self.input = input


class AiReply:
    __slots__ = (
        "text", "input_tokens", "output_tokens", "refused", "tool_calls", "assistant_content",
    )

    def __init__(
        self, text, input_tokens=0, output_tokens=0, refused=False,
        tool_calls=(), assistant_content=None,
    ):
        self.text = text
        self.input_tokens = input_tokens
        self.output_tokens = output_tokens
        self.refused = refused
        self.tool_calls = list(tool_calls)
        # El turno del asistente TAL CUAL lo produjo el modelo. Si pidió herramientas hay que
        # devolvérselo sin tocar al continuar la conversación (incluye su razonamiento firmado).
        self.assistant_content = assistant_content


class AiProvider(ABC):
    name = "abstract"

    @abstractmethod
    def complete(self, system, messages, max_tokens, tools=None):
        """`messages` empieza con `user`. `tools` es una lista de definiciones
        `{"name", "description", "input_schema"}` o `None`. Devuelve un `AiReply` o lanza
        `AiProviderError`."""
