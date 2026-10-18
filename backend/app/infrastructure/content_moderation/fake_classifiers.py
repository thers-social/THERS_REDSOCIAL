# Clasificadores simulados (ADR-044 §2.9, ADR-045 §2.4). Sin red ni credenciales: sirven para las
# pruebas y para desarrollar el flujo completo antes de contratar nada. NO son un detector real.

from app.domain.content_moderation.signals import (
    ClassifierError,
    ImageClassifier,
    Signal,
    TextClassifier,
)


_CLEAN = object()


class FakeImageClassifier(ImageClassifier):
    """Determinista: devuelve `default_scores`, o lo configurado para una clave concreta.
    Un valor que sea una excepción se lanza; `None` simula una respuesta inutilizable."""

    name = "fake"
    model_version = "fake-1"

    def __init__(self, default_scores=_CLEAN, by_key=None):
        # Sin argumento: limpio (todos los puntajes en 0). `None`: respuesta inutilizable.
        self.default_scores = {} if default_scores is _CLEAN else default_scores
        self.by_key = by_key or {}
        self.calls = []

    def classify(self, storage_key):
        self.calls.append(storage_key)
        outcome = self.by_key.get(storage_key, self.default_scores)
        if isinstance(outcome, Exception):
            raise outcome
        if outcome is None:
            return Signal.unclassified(self.name, self.model_version)
        return Signal(outcome, self.name, self.model_version)


class FailingImageClassifier(ImageClassifier):
    """Siempre falla: sirve para probar reintentos y el estado `dead`."""

    name = "fake-failing"

    def classify(self, storage_key):
        raise ClassifierError("simulated failure")


class FakeTextClassifier(TextClassifier):
    name = "fake"
    model_version = "fake-1"

    def __init__(self, scores=None):
        self.scores = scores if scores is not None else {}
        self.calls = 0

    def classify(self, text):
        self.calls += 1
        return Signal(self.scores, self.name, self.model_version)
