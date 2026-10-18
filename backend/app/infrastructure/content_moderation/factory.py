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
