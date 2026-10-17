# Caso de uso del chat de Tero (ADR-041, fase 4). Sin herramientas todavía: el modelo solo
# conversa. Orden deliberado: validar -> ¿IA apagada? -> ¿tope de gasto? -> proveedor -> registrar.

from datetime import datetime, timezone

from app.application.tero.prompt import SYSTEM_PROMPT
from app.domain.tero import budget, chat
from app.domain.tero.provider import AiProviderError


def _result(reply, source):
    return {"reply": reply, "source": source}


def send_message(data, settings, provider, usage_repository, now=None):
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

    # Solo el texto de la conversación llega al modelo. El contexto (pantalla, entidad) se valida
    # pero no se envía: sin herramientas no aporta, y `entity_id` no es de confianza (ADR-041 §5.1).
    messages = request.history + [{"role": "user", "content": request.message}]
    try:
        reply = provider.complete(SYSTEM_PROMPT, messages, chat.MAX_OUTPUT_TOKENS)
    except AiProviderError:
        raise chat.TeroUnavailableError("fallo del proveedor de IA") from None

    # Se cobra aunque el modelo se niegue o no devuelva texto: los tokens ya se gastaron.
    usage_repository.add(
        period,
        reply.input_tokens,
        reply.output_tokens,
        budget.cost_micro_usd(
            reply.input_tokens, reply.output_tokens,
            settings.price_in_micro, settings.price_out_micro,
        ),
    )

    if reply.refused:
        return _result(chat.REFUSED_REPLY, chat.SOURCE_REFUSED)
    text = (reply.text or "").strip()
    if not text:
        raise chat.TeroUnavailableError("respuesta vacía del proveedor")
    return _result(text[: chat.MAX_REPLY_LENGTH], chat.SOURCE_AI)
