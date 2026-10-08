# Validación pura del contenido de un mensaje (ADR-013-messages-minimal-model.md).
# Solo tipos nativos de Python -- domain/ no debe importar Flask ni
# SQLAlchemy (BACKEND_ARCHITECTURE.md §7/§17). Mismo patrón que
# domain/posts/validators.py y domain/comments/validators.py.

MAX_CONTENT_LENGTH = 2000


def is_valid_content_with_images(value):
    """Texto de un mensaje que lleva una imagen (ADR-039): puede estar vacío
    (solo foto), pero no pasar del mismo límite. Un texto ausente cuenta como vacío."""
    if value is None:
        return True
    if not isinstance(value, str):
        return False
    return len(value.strip()) <= MAX_CONTENT_LENGTH


def is_valid_content(value):
    """No vacío tras trim() y dentro del límite máximo. Mismo límite que
    posts (ADR-004) -- un mensaje directo no tiene motivo para ser más
    corto que un post, a diferencia de un comentario (ADR-006, límite
    menor a propósito)."""
    if not isinstance(value, str):
        return False
    trimmed = value.strip()
    return 0 < len(trimmed) <= MAX_CONTENT_LENGTH
