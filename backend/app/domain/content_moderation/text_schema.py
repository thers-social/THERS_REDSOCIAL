# Validación estricta de la salida de un modelo de lenguaje al clasificar texto (ADR-045 §3-§4).
# La respuesta del modelo es DATO sin confianza: solo se acepta un objeto JSON con la forma
# exacta esperada; cualquier otra cosa es «no clasificado» y el contenido va a una persona,
# nunca a aprobado.

import json

from app.domain.content_moderation.signals import CATEGORIES, Signal

MAX_REPLY_CHARS = 2000


def _strip_fence(raw):
    text = raw.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        # ```json ... ```
        if len(lines) >= 3 and lines[-1].strip() == "```":
            text = "\n".join(lines[1:-1]).strip()
    return text


def parse_text_signal(raw, provider, model_version):
    """Devuelve un `Signal` utilizable o `Signal.unclassified`. Nunca lanza.

    Forma aceptada: `{"scores": {"<categoría>": <número entre 0 y 1>, ...}}` y nada más. Una
    categoría desconocida, un valor fuera de rango o una clave extra invalidan TODA la respuesta."""
    unusable = Signal.unclassified(provider, model_version)
    if not isinstance(raw, str) or not raw.strip() or len(raw) > MAX_REPLY_CHARS:
        return unusable
    try:
        data = json.loads(_strip_fence(raw))
    except (ValueError, RecursionError):
        return unusable
    if not isinstance(data, dict) or set(data) != {"scores"} or not isinstance(data["scores"], dict):
        return unusable
    scores = data["scores"]
    if not scores or any(key not in CATEGORIES for key in scores):
        return unusable
    signal = Signal(scores, provider, model_version)
    return signal if signal.usable else unusable
