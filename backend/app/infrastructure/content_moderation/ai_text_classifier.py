# Clasificador de texto sobre el puerto `AiProvider` de Tero (ADR-045 §2.4).
#
# Reutiliza el PUERTO y el adaptador de Anthropic sin modificarlos; lo que NO comparte con Tero:
# credencial (`AI_MODERATION_TEXT_API_KEY`), modelo, prompt, contador de gasto (`ai_usage`),
# historial (ninguno: un solo mensaje), herramientas (ninguna) ni registros.
#
# Garantías (cada una tiene su prueba):
#   * La salida del modelo se valida contra un esquema estricto; lo que no cumpla es «no
#     clasificado», que el motor de políticas manda a una persona. NUNCA aprueba.
#   * Tope de gasto agotado, propósito apagado, rechazo del modelo o texto sospechoso de seguridad
#     infantil -> «no clasificado» SIN llamar al proveedor (lo sospechoso nunca se envía).
#   * Un fallo del proveedor lanza `ClassifierError` (el trabajo se reintenta); nada del texto ni de
#     la respuesta llega al log ni a la base.

import logging
from datetime import datetime, timezone

from app.application.content_moderation import prompts
from app.domain.content_moderation.signals import ClassifierError, Signal, TextClassifier
from app.domain.content_moderation.text_schema import parse_text_signal
from app.domain.tero import budget
from app.domain.tero.provider import AiProviderError

logger = logging.getLogger(__name__)

PROVIDER_NAME = "ai_provider"


class AiProviderTextClassifier(TextClassifier):
    name = PROVIDER_NAME

    def __init__(self, provider, settings, usage_repository, clock=None):
        self._provider = provider
        self._settings = settings
        self._usage = usage_repository
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        self.model_version = f"{settings.model}:{prompts.PROMPT_VERSION}"

    def _unclassified(self):
        return Signal.unclassified(self.name, self.model_version)

    def classify(self, text, child_safety_suspected=False):
        # Lo sospechoso de abuso infantil NO se envía a ningún modelo de propósito general.
        if child_safety_suspected:
            return self._unclassified()
        if not isinstance(text, str) or not text.strip():
            return self._unclassified()
        if not self._settings.usable or self._provider is None:
            return self._unclassified()

        period = budget.period_for(self._clock())
        if self._usage.spent_micro(period, self._settings.purpose) >= self._settings.monthly_budget_micro:
            logger.warning("IA (%s): tope mensual agotado", self._settings.purpose)
            return self._unclassified()

        try:
            reply = self._provider.complete(
                prompts.MODERATION_TEXT_SYSTEM_PROMPT,
                [{"role": "user", "content": prompts.wrap_text(text, self._settings.max_text_chars)}],
                self._settings.max_tokens,
            )
        except AiProviderError:
            # Sin texto del proveedor: ya viene saneado desde el adaptador.
            raise ClassifierError("provider_failed") from None

        # Se registra el gasto aunque la salida no sirva: el proveedor ya cobró.
        self._usage.add(
            period, self._settings.purpose, reply.input_tokens, reply.output_tokens,
            self._settings.cost_micro(reply.input_tokens, reply.output_tokens),
        )
        if reply.refused or reply.tool_calls:
            return self._unclassified()
        return parse_text_signal(reply.text, self.name, self.model_version)
