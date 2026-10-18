# Señales de los clasificadores (ADR-044 §2.9, ADR-045 §2.4). Informan; no deciden.

#: Categorías cerradas. Cualquier otra que devuelva un proveedor se descarta.
CATEGORIES = (
    "sexual", "violence", "hate", "harassment", "self_harm", "spam", "illegal", "child_safety",
)


class ClassifierError(Exception):
    """El clasificador falló (red, tiempo, cuota). Sin texto del proveedor ni del contenido."""


class Signal:
    """Resultado de clasificar un contenido: puntajes en [0, 1] por categoría cerrada.

    `usable=False` significa «no se pudo clasificar» (respuesta fuera de esquema, rechazo del
    modelo): el motor lo trata como revisión humana, nunca como aprobado."""

    __slots__ = ("scores", "usable", "provider", "model_version")

    def __init__(self, scores, provider, model_version, usable=True):
        self.provider = provider
        self.model_version = model_version
        self.usable = bool(usable)
        self.scores = {}
        if self.usable:
            for category, value in (scores or {}).items():
                if category in CATEGORIES and isinstance(value, (int, float)) \
                        and not isinstance(value, bool) and 0.0 <= float(value) <= 1.0:
                    self.scores[category] = float(value)
                else:
                    # Una categoría o un valor fuera de esquema invalida TODA la señal.
                    self.usable = False
                    self.scores = {}
                    break

    @classmethod
    def unclassified(cls, provider, model_version):
        return cls({}, provider, model_version, usable=False)

    @property
    def top_score(self):
        return max(self.scores.values(), default=0.0)

    def categories_over(self, threshold):
        return sorted(c for c, v in self.scores.items() if v >= threshold)


class ImageClassifier:
    """Puerto de clasificación de imágenes. Los adaptadores reales (p. ej. Rekognition) se
    añaden después, tras otra aprobación; hoy solo existe uno simulado."""

    def classify(self, storage_key):
        """Devuelve un `Signal` o lanza `ClassifierError`."""
        raise NotImplementedError


class TextClassifier:
    """Puerto de clasificación de texto (ADR-045). Recibe el texto como DATO."""

    def classify(self, text, child_safety_suspected=False):
        """`child_safety_suspected=True`: el texto NO debe enviarse a ningún modelo de propósito
        general (ADR-044 §3); el adaptador devuelve «no clasificado» sin llamar a nadie."""
        raise NotImplementedError
