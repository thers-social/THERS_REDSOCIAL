# Tero, fase 4 (ADR-041): piezas puras. Validación de la petición, costo, y el adaptador del
# proveedor con un cliente falso. NINGUNA prueba llama a la API real de Anthropic.

import types
from datetime import datetime, timezone

import anthropic
import pytest

from app.domain.tero import budget, chat
from app.domain.tero.provider import AiProviderError
from app.infrastructure.ai.anthropic_provider import AnthropicProvider


# --- Validación de la petición ------------------------------------------------------------


def test_a_plain_message_is_accepted_and_trimmed():
    request = chat.parse_chat_request({"message": "  hola Tero  "})
    assert request.message == "hola Tero"
    assert request.history == []
    assert request.screen is None


@pytest.mark.parametrize(
    "body",
    [
        None,
        [],
        "hola",
        {},
        {"message": ""},
        {"message": "   "},
        {"message": 7},
        {"message": "x" * (chat.MAX_MESSAGE_LENGTH + 1)},
        {"message": "hola", "history": "no"},
        {"message": "hola", "history": [{"role": "system", "content": "x"}]},
        {"message": "hola", "history": [{"role": "assistant", "content": "primero"}]},
        {"message": "hola", "history": [{"role": "user"}]},
        {"message": "hola", "history": [{"role": "user", "content": "x"}] * (chat.MAX_HISTORY_TURNS + 1)},
        {"message": "hola", "context": "feed"},
        {"message": "hola", "context": {"screen": "Feed con espacios"}},
        {"message": "hola", "context": {"entity_type": "universe"}},
        {"message": "hola", "context": {"entity_id": "abc"}},
        {"message": "hola", "context": {"entity_type": "post", "entity_id": "../etc"}},
        {"message": "hola", "context": {"entity_type": "post", "entity_id": 5}},
    ],
)
def test_malformed_requests_are_rejected(body):
    with pytest.raises(chat.InvalidTeroRequestError):
        chat.parse_chat_request(body)


def test_a_full_request_keeps_history_and_context():
    request = chat.parse_chat_request(
        {
            "message": "¿y esto?",
            "history": [
                {"role": "user", "content": "hola"},
                {"role": "assistant", "content": "¡hola!"},
            ],
            "context": {"screen": "post/[id]", "entity_type": "post", "entity_id": "abc-123"},
        }
    )
    assert [turn["role"] for turn in request.history] == ["user", "assistant"]
    assert (request.screen, request.entity_type, request.entity_id) == ("post/[id]", "post", "abc-123")


# --- Costo --------------------------------------------------------------------------------


def test_cost_is_computed_in_micro_usd_and_rounded_up():
    price_in, price_out = budget.usd_to_micro(0.10), budget.usd_to_micro(0.50)
    # 100 * 0.10 + 50 * 0.50 = 35 micro-USD exactos.
    assert budget.cost_micro_usd(100, 50, price_in, price_out) == 35
    # 1 token de entrada vale 0,1 micro-USD: se sobrestima a 1, nunca se queda en 0.
    assert budget.cost_micro_usd(1, 0, price_in, price_out) == 1
    assert budget.cost_micro_usd(0, 0, price_in, price_out) == 0


def test_the_period_is_the_utc_calendar_month():
    assert budget.period_for(datetime(2026, 10, 31, 23, 59, tzinfo=timezone.utc)) == "2026-10"
    assert budget.period_for(datetime(2026, 11, 1, 0, 0, tzinfo=timezone.utc)) == "2026-11"


# --- Adaptador de Anthropic (cliente falso) -----------------------------------------------


def _block(kind, text=None):
    return types.SimpleNamespace(type=kind, text=text)


def _response(content, stop_reason="end_turn", input_tokens=10, output_tokens=5):
    return types.SimpleNamespace(
        content=content,
        stop_reason=stop_reason,
        usage=types.SimpleNamespace(input_tokens=input_tokens, output_tokens=output_tokens),
    )


class FakeClient:
    def __init__(self, response=None, error=None):
        self.calls = []
        self._response, self._error = response, error
        self.messages = types.SimpleNamespace(create=self._create)

    def _create(self, **kwargs):
        self.calls.append(kwargs)
        if self._error:
            raise self._error
        return self._response


def _provider(client):
    return AnthropicProvider("sk-unused", "claude-haiku-5-5", client=client)


def test_only_text_blocks_reach_the_user_and_usage_is_reported():
    client = FakeClient(_response([_block("thinking"), _block("text", "Hola "), _block("text", "mundo")]))
    reply = _provider(client).complete("sistema", [{"role": "user", "content": "hi"}], 512)
    assert reply.text == "Hola mundo"
    assert (reply.input_tokens, reply.output_tokens, reply.refused) == (10, 5, False)


def test_the_request_uses_the_configured_model_low_effort_and_no_sampling_params():
    client = FakeClient(_response([_block("text", "ok")]))
    _provider(client).complete("sistema", [{"role": "user", "content": "hi"}], 512)
    call = client.calls[0]
    assert call["model"] == "claude-haiku-5-5"
    assert call["max_tokens"] == 512
    assert call["system"] == "sistema"
    assert call["output_config"] == {"effort": "low"}
    # Haiku 5.5 rechaza valores no predeterminados de estos parámetros con un 400.
    assert not {"temperature", "top_p", "top_k"} & set(call)


def test_a_refusal_is_reported_without_text():
    client = FakeClient(_response([], stop_reason="refusal"))
    reply = _provider(client).complete("s", [{"role": "user", "content": "hi"}], 512)
    assert reply.refused is True
    assert reply.text == ""


def test_provider_errors_are_hidden_behind_a_generic_error():
    secret = "SECRET-FROM-PROVIDER-sk-ant-123"
    client = FakeClient(error=anthropic.APIError(secret, request=None, body=None))
    with pytest.raises(AiProviderError) as caught:
        _provider(client).complete("s", [{"role": "user", "content": "hi"}], 512)
    assert secret not in str(caught.value)
    assert caught.value.__cause__ is None


# --- Validación de argumentos de herramientas (fase 5) ------------------------------------

from app.domain.tero import tools as tool_rules  # noqa: E402

_SPEC = tool_rules.ToolSpec(
    "demo",
    "herramienta de prueba",
    {
        "query": tool_rules.string_prop("texto", 2, 10),
        "limit": tool_rules.integer_prop("tope", 1, 5),
        "post_id": tool_rules.uuid_prop("id"),
    },
    required=("query",),
)


def test_valid_arguments_are_cleaned():
    clean = tool_rules.validate_arguments(_SPEC, {"query": "  hola   mundo ", "limit": 3})
    assert clean == {"query": "hola mundo", "limit": 3}


def test_missing_arguments_default_to_an_empty_object():
    spec = tool_rules.ToolSpec("sin_args", "no pide nada")
    assert tool_rules.validate_arguments(spec, None) == {}


@pytest.mark.parametrize(
    "arguments",
    [
        [],
        "query",
        {},                                         # falta lo obligatorio
        {"query": "hola", "user_id": "otro"},       # propiedad que el esquema no declara
        {"query": 5},
        {"query": "a"},                             # demasiado corto
        {"query": "x" * 11},                        # demasiado largo
        {"query": "ho\x00la"},                      # carácter de control
        {"query": "hola", "limit": True},           # un booleano no es un entero
        {"query": "hola", "limit": "3"},
        {"query": "hola", "limit": 0},
        {"query": "hola", "limit": 6},
        {"query": "hola", "post_id": "no-es-uuid"},
        {"query": "hola", "post_id": "../../etc/passwd"},
    ],
)
def test_arguments_outside_the_schema_are_rejected(arguments):
    with pytest.raises(tool_rules.ToolInputError):
        tool_rules.validate_arguments(_SPEC, arguments)


def test_the_schema_sent_to_the_model_is_strict():
    schema = _SPEC.to_definition()["input_schema"]
    assert schema["additionalProperties"] is False
    assert schema["required"] == ["query"]


# --- Adaptador con herramientas -----------------------------------------------------------


class _Block:
    def __init__(self, data):
        self._data = data
        self.__dict__.update(data)

    def to_dict(self):
        return dict(self._data)


def test_tools_are_sent_without_a_forced_tool_choice():
    client = FakeClient(_response([_block("text", "ok")]))
    definitions = [{"name": "profile_read", "description": "x", "input_schema": {"type": "object"}}]
    _provider(client).complete("s", [{"role": "user", "content": "hi"}], 512, definitions)
    call = client.calls[0]
    assert call["tools"] == definitions
    assert "tool_choice" not in call


def test_no_tools_key_is_sent_when_there_are_none():
    client = FakeClient(_response([_block("text", "ok")]))
    _provider(client).complete("s", [{"role": "user", "content": "hi"}], 512)
    assert "tools" not in client.calls[0]


def test_a_tool_request_returns_the_calls_and_the_turn_untouched():
    thinking = _Block({"type": "thinking", "thinking": "", "signature": "firma"})
    tool_use = _Block({"type": "tool_use", "id": "toolu_9", "name": "users_search", "input": {"query": "ana"}})
    client = FakeClient(_response([thinking, tool_use], stop_reason="tool_use"))
    reply = _provider(client).complete("s", [{"role": "user", "content": "hi"}], 512)
    assert [(c.id, c.name, c.input) for c in reply.tool_calls] == [
        ("toolu_9", "users_search", {"query": "ana"})
    ]
    assert reply.assistant_content == [
        {"type": "thinking", "thinking": "", "signature": "firma"},
        {"type": "tool_use", "id": "toolu_9", "name": "users_search", "input": {"query": "ana"}},
    ]


def test_the_prompt_asks_for_plain_text_and_trusts_the_apps_card_lines():
    from app.application.tero.prompt import SYSTEM_PROMPT

    # La app muestra el texto tal cual: sin Markdown se ven los asteriscos.
    assert "texto plano" in SYSTEM_PROMPT and "Markdown" in SYSTEM_PROMPT
    # Las líneas de resultado de las tarjetas las añade la app y el modelo debe creerlas...
    assert "[Tarjeta" in SYSTEM_PROMPT and "fiables" in SYSTEM_PROMPT
    # ...pero la pantalla/identificador que manda el cliente sigue siendo un dato sin verificar.
    assert "dato sin verificar" in SYSTEM_PROMPT
    # Y sigue siendo un texto fijo, sin datos de nadie.
    assert "@" not in SYSTEM_PROMPT


def test_a_plain_answer_has_no_calls_and_no_turn_to_replay():
    client = FakeClient(_response([_block("text", "hola")]))
    reply = _provider(client).complete("s", [{"role": "user", "content": "hi"}], 512)
    assert reply.tool_calls == []
    assert reply.assistant_content is None
