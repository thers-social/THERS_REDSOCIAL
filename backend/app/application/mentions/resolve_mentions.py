# Resolución de menciones de un texto (ADR-023-mentions.md). Es el único lugar
# del backend que decide a quién se menciona de verdad, y lo usan los cuatro
# caminos que escriben contenido: crear/editar una publicación y crear/editar
# un comentario.
#
# Tres pasos, en este orden:
#   1. Extraer los @username candidatos del texto (parser puro, domain/).
#   2. Quedarse con los que existen Y cuyo dueño autoriza esa mención
#      (`who_can_mention`).
#   3. Persistir el conjunto resultante y notificar solo a los nuevos.
#
# El permiso se evalúa al ESCRIBIR, no al leer: así una mención ya aceptada
# sigue siendo válida si después la persona cierra sus menciones, y un
# @username que nunca tuvo permiso no se convierte en mención retroactivamente
# (ADR-023 §Decisión).

from app.domain.follows.follow_status import ACCEPTED
from app.domain.mentions.parser import extract_usernames
from app.domain.privacy.audience import FOLLOWERS, is_allowed


def _authorized_mentions(
    content, author_id, user_repository, follow_repository, restriction_repository,
    allowed_ids=None,
):
    """Usuarios realmente mencionables en `content` por `author_id`.

    `allowed_ids` (ADR-054): en una publicación solo para mejores amigos, solo se puede mencionar
    a quien puede verla; a los demás el @texto les queda como texto y no se les avisa."""
    usernames = extract_usernames(content)
    if not usernames:
        return []

    # Una sola consulta para todos los @username del texto, no una por
    # mención (ADR-023 §Riesgos).
    candidates = user_repository.find_by_usernames(usernames)

    # Un bloqueo en cualquier sentido anula la mención (ADR-029): ni se
    # notifica a quien bloqueó, ni se le "etiqueta" a quien fue bloqueado. Una
    # sola consulta para todos los candidatos.
    blocked_ids = restriction_repository.blocked_ids_either_way(author_id)
    candidates = [user for user in candidates if str(user.id) not in blocked_ids]
    if allowed_ids is not None:
        candidates = [user for user in candidates if str(user.id) in allowed_ids]
    if not candidates:
        return []

    # `who_can_mention = 'followers'` significa "solo quienes me siguen".
    # Ojo con la dirección: hay que preguntar si el AUTOR del texto sigue al
    # MENCIONADO, no al revés. Se resuelve en una sola consulta para todos los
    # candidatos que lo necesiten.
    needs_follow_check = [
        user.id for user in candidates if user.who_can_mention == FOLLOWERS
    ]
    follow_statuses = (
        follow_repository.follow_statuses(author_id, needs_follow_check)
        if needs_follow_check
        else {}
    )
    authorized = []
    for user in candidates:
        is_self = str(user.id) == str(author_id)
        author_follows_them = follow_statuses.get(user.id) == ACCEPTED
        if is_allowed(user.who_can_mention, author_follows_them, actor_is_self=is_self):
            authorized.append(user)

    return authorized


def _notify(mentioned_users, newly_added_ids, author_id, post_id, notification_repository):
    for user in mentioned_users:
        if str(user.id) not in {str(i) for i in newly_added_ids}:
            # Ya estaba mencionado antes de esta edición -- no se re-notifica
            # (ADR-023 §Decisión).
            continue
        if str(user.id) == str(author_id):
            # Nadie se notifica a sí mismo, mismo criterio que like/comment
            # sobre contenido propio (ADR-008 §No objetivos).
            continue
        notification_repository.create(
            recipient_id=user.id,
            actor_id=author_id,
            notification_type="mention",
            post_id=post_id,
        )


def resolve_post_mentions(
    post_id, author_id, content, user_repository, follow_repository,
    mention_repository, notification_repository, restriction_repository, allowed_ids=None,
):
    """Sincroniza las menciones de una publicación y notifica a las nuevas.

    Devuelve la lista de usuarios mencionados (todos, no solo los nuevos) para
    que el presenter pueda exponerlos sin volver a consultarlos.
    """
    mentioned = _authorized_mentions(
        content, author_id, user_repository, follow_repository, restriction_repository,
        allowed_ids,
    )
    newly_added = mention_repository.replace_for_post(
        post_id, author_id, [user.id for user in mentioned]
    )
    _notify(mentioned, newly_added, author_id, post_id, notification_repository)
    return mentioned


def resolve_comment_mentions(
    comment_id, post_id, author_id, content, user_repository, follow_repository,
    mention_repository, notification_repository, restriction_repository, allowed_ids=None,
):
    """Igual que `resolve_post_mentions`, sobre un comentario.

    `post_id` se recibe solo para la notificación: `notifications` guarda
    `post_id` pero no `comment_id` (ADR-008 §Modelo de datos, limitación que
    ADR-020 §Riesgos ya dejó registrada), así que una mención en un comentario
    notifica apuntando al post que la contiene -- que es además adónde hay que
    navegar para verla.
    """
    mentioned = _authorized_mentions(
        content, author_id, user_repository, follow_repository, restriction_repository,
        allowed_ids,
    )
    newly_added = mention_repository.replace_for_comment(
        comment_id, author_id, [user.id for user in mentioned]
    )
    _notify(mentioned, newly_added, author_id, post_id, notification_repository)
    return mentioned
