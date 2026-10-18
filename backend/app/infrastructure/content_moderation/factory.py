# Fábrica del clasificador de imágenes (ADR-044 §2.9). Hoy solo existe el simulado, y solo si se
# pide explícitamente: sin `MODERATION_CLASSIFIER=fake` no hay clasificador y el worker deja
# todo lo nuevo retenido para una persona (falla cerrado). Un adaptador real (p. ej. Rekognition)
# se añade aquí tras su evaluación y otra aprobación de gasto.

import logging

from app.infrastructure.content_moderation.fake_classifiers import FakeImageClassifier

_logger = logging.getLogger(__name__)


def image_classifier(app):
    choice = app.config.get("MODERATION_CLASSIFIER", "none")
    if choice == "fake":
        return FakeImageClassifier()
    if choice not in ("none", ""):
        # Un valor desconocido NO cae en un clasificador permisivo: se comporta como `none`.
        _logger.warning("MODERATION_CLASSIFIER desconocido (%s); se usa 'none'.", choice)
    return None


def text_classifier(app):
    """Clasificador de texto del propósito `moderation_text` (ADR-045). `None` si el propósito está
    apagado o sin credencial PROPIA: nunca cae en la clave de Tero. Con
    `MODERATION_TEXT_CLASSIFIER=fake` (solo desarrollo y pruebas) devuelve el simulado."""
    if app.config.get("MODERATION_TEXT_CLASSIFIER") == "fake":
        from app.infrastructure.content_moderation.fake_classifiers import FakeTextClassifier

        return FakeTextClassifier()

    from app.application.content_moderation.ai_purposes import MODERATION_TEXT, settings_from_config

    settings = settings_from_config(MODERATION_TEXT, app.config)
    if not settings.usable:
        return None
    from app.infrastructure.ai.anthropic_provider import AnthropicProvider
    from app.infrastructure.content_moderation.ai_text_classifier import AiProviderTextClassifier
    from app.infrastructure.persistence.repositories.ai_usage_repository import (
        SQLAlchemyAiUsageRepository,
    )

    # Instancia PROPIA del adaptador, con la clave y el modelo de este propósito. Tero conserva la
    # suya en `app.extensions["thers_tero"]`; no se comparte nada.
    provider = AnthropicProvider(settings.api_key, settings.model, settings.timeout_seconds)
    return AiProviderTextClassifier(provider, settings, SQLAlchemyAiUsageRepository())
