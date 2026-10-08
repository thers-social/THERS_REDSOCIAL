from app.application.media.attachments import to_public_images
from app.application.mentions.mention_presenter import to_public_mentions
from app.domain.follows.follow_status import ACCEPTED

# Forma pública del objeto `post` devuelto por create/list (ADR-004 §Contrato,
# extendido por ADR-005 con likes_count/liked_by_me, por ADR-006 con
# comments_count y por ADR-007 con author.is_followed_by_me) -- centralizada
# acá para no duplicarla entre casos de uso, mismo patrón que
# application/auth/user_presenter.py. El autor se expone con la misma forma
# reducida en ambos endpoints -- nunca email/phone/password_hash/otros
# campos privados de `users`.


from app.application.auth.user_presenter import to_author_summary


def to_public_post(
    post, likes_count=0, liked_by_me=False, comments_count=0, follow_status=None,
    mentions=None,
):
    # Defaults en 0/False: un post recién creado (create_post_use_case.py)
    # no tiene resumen de likes/comentarios que calcular todavía (ADR-005/
    # ADR-006 §Contrato API); `follow_status` en None por default porque nadie
    # se sigue a sí mismo (ADR-007 §Opciones consideradas) -- un post recién
    # creado siempre es del propio autor autenticado.
    return {
        "id": str(post.id),
        "author": {
            **to_author_summary(post.author),
            # `is_followed_by_me` se mantiene (ADR-007, v0.12 del contrato) y
            # sigue significando exactamente lo mismo: relación efectiva. Una
            # solicitud pendiente es `false` acá -- pedir no es seguir.
            "is_followed_by_me": follow_status == ACCEPTED,
            # `follow_status` (ADR-022): null | 'pending' | 'accepted'. Es lo
            # que permite al Frontend dibujar el tercer estado del botón
            # ("Solicitado") sin inferirlo de `is_followed_by_me`.
            "follow_status": follow_status,
            # Para que el Frontend sepa que, si todavía no sigue a esta
            # persona, el botón manda una solicitud y no un follow directo.
            "is_private": post.author.is_private,
        },
        "content": post.content,
        # Imágenes adjuntas (ADR-039): `[]` si no tiene. Solo URL y dimensiones.
        "images": to_public_images(post.images),
        # Lo que el AUTOR declaró al publicar (ADR-030-content-preferences.md);
        # no es una clasificación del servidor.
        "is_sensitive": post.is_sensitive,
        "created_at": post.created_at.isoformat(),
        # Quiénes están mencionados de verdad en `content` (ADR-023). El texto
        # conserva el @username tal como se escribió; esta lista es la que
        # permite enlazarlo, y deja fuera los @algo que no son menciones
        # reales (username inexistente, o que no autorizó la mención).
        "mentions": to_public_mentions(mentions),
        # Booleano, nunca el timestamp `edited_at` crudo -- mismo criterio
        # que `read` en messages/notifications (ADR-021-content-editing.md).
        "edited": post.edited_at is not None,
        "likes_count": likes_count,
        "liked_by_me": liked_by_me,
        "comments_count": comments_count,
    }
