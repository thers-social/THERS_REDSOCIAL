# Forma pública del objeto `notification` devuelto por GET /api/notifications
# (ADR-008-notifications-minimal-model.md §Contrato) -- centralizada acá para
# no duplicarla, mismo patrón que application/posts/post_presenter.py y
# application/comments/comment_presenter.py. El actor se expone con la misma
# forma reducida que en `posts`/`comments` -- nunca email/phone/
# password_hash ni otros campos privados.


from app.application.auth.user_presenter import to_author_summary


def _place_summary(place):
    # Solo identifica el lugar: nunca texto de la reserva, la cotización ni de la reseña.
    return {"id": str(place.id), "name": place.name} if place is not None else None


def to_public_notification(notification):
    return {
        "id": str(notification.id),
        "type": notification.type,
        # Nulo solo en `place_claim_decided` (ADR-040 fase 12).
        "actor": to_author_summary(notification.actor) if notification.actor is not None else None,
        "post_id": str(notification.post_id) if notification.post_id else None,
        # Fase 12: avisos de Places. Nulos en like/comment/follow/mention.
        "place": _place_summary(notification.place),
        "object_id": str(notification.object_id) if notification.object_id else None,
        "detail": notification.detail,
        # Se expone como booleano, nunca como el timestamp `read_at` crudo
        # -- mismo criterio que `username_changed_at` nunca cruza la
        # frontera HTTP tal cual (API_CONTRACT.md §5).
        "read": notification.read_at is not None,
        "created_at": notification.created_at.isoformat(),
    }
