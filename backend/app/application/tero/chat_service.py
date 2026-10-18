# Caso de uso del chat de Tero (ADR-041, fases 4 y 5).
#
# Orden deliberado: validar -> ¿IA apagada? -> ¿tope de gasto? -> proveedor (con vueltas de
# herramientas si están encendidas) -> registrar el gasto.
#
# El modelo NO ejecuta nada: pide una herramienta por nombre, este módulo valida los argumentos y
# la ejecuta con la identidad del JWT. El resultado vuelve al modelo como DATO (`tool_result`),
# nunca como instrucción (ADR-041 §6.1).

import json
import logging
import time
from datetime import datetime, timezone

from app.application.tero import tools
from app.application.tero.prompt import SYSTEM_PROMPT
from app.domain.tero import budget, chat
from app.domain.tero import tools as tool_rules
from app.domain.tero.provider import AiProviderError

logger = logging.getLogger(__name__)

_TOOL_ERROR = "No se pudo completar la consulta."
_UNKNOWN_TOOL = "Esa herramienta no existe."


def _result(reply, source, cards=()):
    # `confirmation_cards`: acciones que Tero PREPARÓ y que esperan la confirmación de la persona.
    # Siempre presente (lista vacía si no hay), para que el cliente no tenga que adivinar.
    return {"reply": reply, "source": source, "confirmation_cards": list(cards)}


def _context_hint(request):
    """Dónde está la persona, como DATO sin confianza. Solo valores ya validados por forma
    (letras, números, guiones); las herramientas revalidan cualquier identificador contra los
    permisos reales antes de usarlo."""
    parts = []
    if request.screen:
        parts.append(f"pantalla={request.screen}")
    if request.entity_type and request.entity_id:
        parts.append(f"{request.entity_type}_id={request.entity_id}")
    if not parts:
        return None
    return "[Contexto de la pantalla, dato sin verificar: " + "; ".join(parts) + "]"


def _execute_tool(call, user_id, deps, allow_proposals, cards):
    """Devuelve un bloque `tool_result`. Un fallo de la herramienta NUNCA escapa: el modelo recibe
    un mensaje genérico (los detalles internos no se le cuentan) y puede seguir conversando."""
    started = time.perf_counter()
    status = "ok"
    is_error = False
    if not tools.is_available(call.name, allow_proposals):
        status, is_error, content = "unknown", True, _UNKNOWN_TOOL
    else:
        try:
            result = tools.run_tool(call.name, call.input, user_id, deps, allow_proposals)
            # La tarjeta va al CLIENTE, no al modelo: lo que se aprueba lo ve la persona tal cual.
            card = result.pop("_card", None)
            if card is not None:
                cards.append(card)
            content = json.dumps(result, ensure_ascii=False)
        except tool_rules.ToolInputError as error:
            status, is_error, content = "invalid_input", True, str(error)
        except Exception as error:  # noqa: BLE001 -- nada interno puede llegar al modelo
            status, is_error, content = "error", True, _TOOL_ERROR
            logger.warning("Tero: fallo en la herramienta %s (%s)", call.name, type(error).__name__)
    # Auditoría sin contenido: ni argumentos ni resultados, solo qué, quién, cómo y cuánto tardó.
    logger.info(
        "Tero tool=%s user=%s status=%s ms=%d",
        call.name, user_id, status, int((time.perf_counter() - started) * 1000),
    )
    block = {"type": "tool_result", "tool_use_id": call.id, "content": content}
    if is_error:
        block["is_error"] = True
    return block


def send_message(
    data, settings, provider, usage_repository, now=None, user_id=None, tool_deps=None,
):
    request = chat.parse_chat_request(data)

    # Interruptor de IA (TERO_AI_ENABLED): respuesta fija, sin llamar a nadie. Útil en staging.
    if not settings.ai_enabled:
        return _result(chat.DISABLED_REPLY, chat.SOURCE_DISABLED)

    if provider is None:
        # IA encendida pero sin clave: es un error de configuración, no una respuesta amable.
        raise chat.TeroUnavailableError("sin proveedor de IA configurado")

    period = budget.period_for(now or datetime.now(timezone.utc))
    if usage_repository.spent_micro(period) >= settings.monthly_budget_micro:
        return _result(chat.BUDGET_REPLY, chat.SOURCE_BUDGET)

    use_tools = bool(settings.tools_enabled and tool_deps is not None and user_id is not None)
    allow_proposals = bool(use_tools and settings.actions_enabled)
    definitions = tools.tool_definitions(allow_proposals) if use_tools else None
    cards = []

    # Sin herramientas (fase 4) el contexto no viaja: no aporta y `entity_id` no es de confianza.
    last_user_content = request.message
    if use_tools:
        hint = _context_hint(request)
        if hint:
            last_user_content = [
                {"type": "text", "text": request.message},
                {"type": "text", "text": hint},
            ]
    messages = request.history + [{"role": "user", "content": last_user_content}]

    input_tokens = output_tokens = 0
    try:
        reply = None
        for round_number in range(tool_rules.MAX_TOOL_ROUNDS + 1):
            try:
                reply = provider.complete(SYSTEM_PROMPT, messages, chat.MAX_OUTPUT_TOKENS, definitions)
            except AiProviderError:
                raise chat.TeroUnavailableError("fallo del proveedor de IA") from None
            input_tokens += reply.input_tokens
            output_tokens += reply.output_tokens

            if not (use_tools and reply.tool_calls):
                break
            if round_number == tool_rules.MAX_TOOL_ROUNDS:
                # El modelo sigue pidiendo herramientas tras el tope de vueltas: se corta.
                raise chat.TeroUnavailableError("demasiadas vueltas de herramientas")

            messages.append({"role": "assistant", "content": reply.assistant_content})
            calls = reply.tool_calls[: tool_rules.MAX_TOOL_CALLS_PER_ROUND]
            blocks = [
                _execute_tool(call, user_id, tool_deps, allow_proposals, cards) for call in calls
            ]
            # Las llamadas que sobran por encima del tope también deben responderse.
            for call in reply.tool_calls[tool_rules.MAX_TOOL_CALLS_PER_ROUND:]:
                blocks.append(
                    {"type": "tool_result", "tool_use_id": call.id,
                     "content": "Demasiadas consultas a la vez.", "is_error": True}
                )
            # Todos los resultados en UN solo mensaje del usuario.
            messages.append({"role": "user", "content": blocks})
    finally:
        # Se cobra aunque el modelo se niegue, no devuelva texto o falle a mitad de camino: los
        # tokens de las vueltas ya hechas se gastaron.
        if input_tokens or output_tokens:
            usage_repository.add(
                period, input_tokens, output_tokens,
                budget.cost_micro_usd(
                    input_tokens, output_tokens,
                    settings.price_in_micro, settings.price_out_micro,
                ),
            )

    if reply.refused:
        return _result(chat.REFUSED_REPLY, chat.SOURCE_REFUSED, cards)
    text = (reply.text or "").strip()
    if not text:
        raise chat.TeroUnavailableError("respuesta vacía del proveedor")
    return _result(text[: chat.MAX_REPLY_LENGTH], chat.SOURCE_AI, cards)
