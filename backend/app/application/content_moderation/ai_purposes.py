# Propósitos de IA y su configuración separada (ADR-045 §2). Cada propósito tiene su clave, su
# modelo, su prompt, su tope de gasto y su contador. NINGUNO usa la configuración de otro: en
# particular, ninguno lee `ANTHROPIC_API_KEY` ni `TERO_*`.
#
# application/ no importa Flask: la fábrica arma esto desde `current_app.config`.

from app.domain.tero import budget

MODERATION_TEXT = "moderation_text"

#: Registro cerrado. Un propósito que no está aquí no existe: no se puede "inventar" uno en
#: tiempo de ejecución para saltarse un tope.
PURPOSES = (MODERATION_TEXT,)


class PurposeSettings:
    __slots__ = (
        "purpose", "enabled", "api_key", "model", "timeout_seconds", "max_tokens",
        "max_text_chars", "monthly_budget_micro", "price_in_micro", "price_out_micro",
    )

    def __init__(self, purpose, enabled=False, api_key=None, model=None, timeout_seconds=20.0,
                 max_tokens=200, max_text_chars=4000, monthly_budget_micro=5_000_000,
                 price_in_micro=100_000, price_out_micro=500_000):
        if purpose not in PURPOSES:
            raise ValueError("unknown_purpose")
        self.purpose = purpose
        self.enabled = bool(enabled)
        self.api_key = api_key
        self.model = model
        self.timeout_seconds = timeout_seconds
        self.max_tokens = max_tokens
        self.max_text_chars = max_text_chars
        self.monthly_budget_micro = monthly_budget_micro
        self.price_in_micro = price_in_micro
        self.price_out_micro = price_out_micro

    @property
    def usable(self):
        """Encendido Y con credencial propia y modelo. Sin eso el propósito no llama a nadie."""
        return self.enabled and bool(self.api_key) and bool(self.model)

    def cost_micro(self, input_tokens, output_tokens):
        return budget.cost_micro_usd(
            input_tokens, output_tokens, self.price_in_micro, self.price_out_micro
        )


def settings_from_config(purpose, config):
    """Lee SOLO las variables `AI_<PROPOSITO>_*` de este propósito."""
    prefix = f"AI_{purpose.upper()}_"
    return PurposeSettings(
        purpose,
        enabled=config.get(prefix + "ENABLED"),
        api_key=config.get(prefix + "API_KEY"),
        model=config.get(prefix + "MODEL"),
        timeout_seconds=config.get(prefix + "TIMEOUT_SECONDS", 20.0),
        monthly_budget_micro=config.get(prefix + "MONTHLY_BUDGET_MICRO", 5_000_000),
        price_in_micro=config.get(prefix + "PRICE_INPUT_MICRO_PER_MTOK", 100_000),
        price_out_micro=config.get(prefix + "PRICE_OUTPUT_MICRO_PER_MTOK", 500_000),
    )
