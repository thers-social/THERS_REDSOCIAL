# Quién puede ver una imagen adjunta (ADR-044 §2.1). Misma idea que `media_url`: `create_app()` fija
# el interruptor una sola vez y los presenters no conocen Flask.
#
# Con la moderación APAGADA no cambia nada: todas las imágenes se ven, como siempre.
# Con ella ENCENDIDA:
#   * un tercero solo ve las `approved`;
#   * quien subió la imagen la ve siempre, pero las que no están aprobadas llegan SIN URL y con su
#     `moderation_status` (el archivo tampoco se sirve: ver `media_routes`).
# Fallar cerrado: sin `viewer_id` solo se ven las aprobadas.

APPROVED = "approved"

_enabled = False


def configure_moderation(enabled):
    global _enabled
    _enabled = bool(enabled)


def is_enabled():
    return _enabled


def visible_images(images, viewer_id=None):
    """Imágenes que `viewer_id` puede ver (las suyas incluidas, aunque estén pendientes)."""
    if not _enabled:
        return list(images or [])
    viewer = str(viewer_id) if viewer_id else None
    return [
        image for image in (images or [])
        if image.moderation_status == APPROVED or (viewer and str(image.owner_id) == viewer)
    ]
