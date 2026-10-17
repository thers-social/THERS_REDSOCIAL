# Puerto del proveedor de IA (ADR-041 §3). Cambiar de proveedor es escribir otra clase que
# cumpla esto en infrastructure/ai/; nada más del backend conoce su SDK.

from abc import ABC, abstractmethod


class AiProviderError(Exception):
    """Cualquier fallo del proveedor (red, tiempo, cuota, 5xx). El mensaje NUNCA debe llevar el
    texto del proveedor ni datos del usuario: se registra aparte, sin contenido."""


class AiReply:
    __slots__ = ("text", "input_tokens", "output_tokens", "refused")

    def __init__(self, text, input_tokens=0, output_tokens=0, refused=False):
        self.text = text
        self.input_tokens = input_tokens
        self.output_tokens = output_tokens
        self.refused = refused


class AiProvider(ABC):
    name = "abstract"

    @abstractmethod
    def complete(self, system, messages, max_tokens):
        """`messages` es una lista de `{"role": "user"|"assistant", "content": str}` que empieza
        con `user`. Devuelve un `AiReply` o lanza `AiProviderError`."""
