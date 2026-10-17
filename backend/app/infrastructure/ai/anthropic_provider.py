# Proveedor de IA: API de Anthropic (ADR-041 §4). ÚNICO archivo del backend que importa el SDK
# (mismo criterio que confina `resend` a infrastructure/email/).
#
# - Modelo Haiku 5.5: pensamiento adaptativo activo por defecto y esfuerzo `medium`; para un chat
#   corto se baja a `low`. No se envían `temperature`/`top_p` (valores no predeterminados dan 400).
# - Herramientas: se envían tal cual y SIN `tool_choice` (el modelo decide; forzar una está
#   restringido en varios modelos). El turno del asistente se devuelve íntegro en
#   `assistant_content` porque, al continuar tras una herramienta, hay que reenviarlo sin cambios.
# - La clave vive solo aquí, leída de la configuración del servidor; nunca va al móvil.
# - Ningún error filtra el texto del proveedor ni el contenido de la conversación: al log solo va
#   el tipo de error y el código HTTP.

import logging

from app.domain.tero.provider import AiProvider, AiProviderError, AiReply, ToolCall

logger = logging.getLogger(__name__)


def _block_to_dict(block):
    if hasattr(block, "to_dict"):
        return block.to_dict()
    return block.model_dump(exclude_none=True)


class AnthropicProvider(AiProvider):
    name = "anthropic"

    def __init__(self, api_key, model, timeout_seconds=20.0, client=None):
        self._model = model
        if client is None:
            import anthropic

            # Un reintento: la caída de un cliente no debe duplicar el gasto ni la espera.
            client = anthropic.Anthropic(api_key=api_key, timeout=timeout_seconds, max_retries=1)
        self._client = client

    def complete(self, system, messages, max_tokens, tools=None):
        import anthropic

        request = {
            "model": self._model,
            "max_tokens": max_tokens,
            "system": system,
            "messages": messages,
            "output_config": {"effort": "low"},
        }
        if tools:
            request["tools"] = tools

        try:
            response = self._client.messages.create(**request)
        except anthropic.APIError as error:
            logger.warning(
                "Tero: fallo del proveedor de IA (%s, status=%s)",
                type(error).__name__, getattr(error, "status_code", None),
            )
            raise AiProviderError("fallo del proveedor de IA") from None

        usage = getattr(response, "usage", None)
        input_tokens = getattr(usage, "input_tokens", 0) or 0
        output_tokens = getattr(usage, "output_tokens", 0) or 0
        if response.stop_reason == "refusal":
            return AiReply("", input_tokens, output_tokens, refused=True)

        # `content` puede traer bloques de pensamiento: solo el texto va al usuario.
        text = "".join(block.text for block in response.content if block.type == "text")
        tool_calls = [
            ToolCall(block.id, block.name, block.input)
            for block in response.content
            if block.type == "tool_use"
        ]
        assistant_content = (
            [_block_to_dict(block) for block in response.content] if tool_calls else None
        )
        return AiReply(
            text, input_tokens, output_tokens,
            tool_calls=tool_calls, assistant_content=assistant_content,
        )
