# Casos de uso de los chats grupales (ADR-048): crear, ver, renombrar, gestionar miembros, salir.
# Toda identidad viene del JWT. Un grupo del que no se es miembro "no existe" (GroupNotFoundError).

from app.application.groups.group_presenter import (
    to_public_group,
    to_public_group_summary,
)
from app.application.media.attachments import discard_files
from app.domain.auth.exceptions import UserNotFoundError
from app.domain.follows.follow_status import ACCEPTED
from app.domain.groups.exceptions import (
    CannotAddMemberError,
    GroupFullError,
    GroupNotFoundError,
    InvalidGroupError,
    NotGroupAdminError,
)
from app.domain.groups.rules import ADMIN, MAX_MEMBERS, clean_name
from app.domain.privacy.audience import is_allowed
from app.domain.restrictions.kinds import BLOCK


def _require_member(group_id, user_id, group_repository):
    membership = group_repository.membership(group_id, user_id)
    if membership is None:
        raise GroupNotFoundError()
    return membership


def _require_admin(group_id, user_id, group_repository):
    membership = _require_member(group_id, user_id, group_repository)
    if membership.role != ADMIN:
        raise NotGroupAdminError()
    return membership


def _check_can_add(actor_id, target_ids, user_repository, follow_repository, restriction_repository):
    """Añadir a alguien a un grupo es escribirle: se exigen las mismas reglas que un mensaje directo
    (bloqueo en cualquier sentido y `who_can_message`, ADR-024/029). Un solo error para todos los
    motivos: no se revela un bloqueo."""
    for target_id in target_ids:
        target = user_repository.find_by_id(target_id)
        if target is None:
            raise CannotAddMemberError()
        if (
            restriction_repository.get_kind(target_id, actor_id) == BLOCK
            or restriction_repository.get_kind(actor_id, target_id) == BLOCK
        ):
            raise CannotAddMemberError()
        actor_follows = (
            follow_repository.follow_statuses(actor_id, [target.id]).get(target.id) == ACCEPTED
        )
        if not is_allowed(target.who_can_message, actor_follows):
            raise CannotAddMemberError()


def _dedupe(ids, exclude=None):
    seen, out = set(), []
    for value in ids:
        value = str(value)
        if value != str(exclude) and value not in seen:
            seen.add(value)
            out.append(value)
    return out


def create_group(
    creator_id, name, member_ids, user_repository, group_repository, follow_repository,
    restriction_repository,
):
    clean = clean_name(name)
    members = _dedupe(member_ids, exclude=creator_id)
    if clean is None or not members:
        raise InvalidGroupError()
    if len(members) + 1 > MAX_MEMBERS:
        raise GroupFullError()
    _check_can_add(creator_id, members, user_repository, follow_repository, restriction_repository)

    group = group_repository.create(clean, creator_id, members)
    return _detail(group.id, creator_id, group_repository)


def _detail(group_id, user_id, group_repository):
    group = group_repository.get(group_id)
    mine = _require_member(group_id, user_id, group_repository)
    return to_public_group(group, group_repository.members(group_id), mine)


def get_group(group_id, user_id, group_repository):
    return _detail(group_id, user_id, group_repository)


def list_groups(user_id, group_repository):
    return [to_public_group_summary(row) for row in group_repository.list_for_user(user_id)]


def rename_group(group_id, user_id, name, group_repository):
    _require_admin(group_id, user_id, group_repository)
    clean = clean_name(name)
    if clean is None:
        raise InvalidGroupError()
    group_repository.rename(group_id, clean)
    return _detail(group_id, user_id, group_repository)


def add_members(
    group_id, user_id, new_member_ids, user_repository, group_repository, follow_repository,
    restriction_repository,
):
    _require_admin(group_id, user_id, group_repository)
    current = {str(m.user_id) for m in group_repository.members(group_id)}
    fresh = [uid for uid in _dedupe(new_member_ids) if uid not in current]
    if not fresh:
        raise InvalidGroupError()
    if len(current) + len(fresh) > MAX_MEMBERS:
        raise GroupFullError()
    _check_can_add(user_id, fresh, user_repository, follow_repository, restriction_repository)
    group_repository.add_members(group_id, fresh)
    return _detail(group_id, user_id, group_repository)


def promote_member(group_id, user_id, target_id, group_repository):
    _require_admin(group_id, user_id, group_repository)
    if group_repository.membership(group_id, target_id) is None:
        raise UserNotFoundError()
    group_repository.set_role(group_id, target_id, ADMIN)
    return _detail(group_id, user_id, group_repository)


def remove_member(group_id, user_id, target_id, group_repository):
    """Un administrador saca a un miembro NORMAL. A otro administrador no (primero debería dejar de
    serlo, y eso no existe: se va él mismo); a uno mismo, con `leave_group`."""
    _require_admin(group_id, user_id, group_repository)
    target = group_repository.membership(group_id, target_id)
    if target is None or target.role == ADMIN:
        raise UserNotFoundError()
    group_repository.remove_member(group_id, target_id)
    return _detail(group_id, user_id, group_repository)


def leave_group(group_id, user_id, group_repository, media_storage=None):
    """Salir de un grupo. Si era el único administrador, el miembro más antiguo pasa a serlo; si era la
    última persona, el grupo (y sus mensajes) se borra."""
    was_admin = _require_member(group_id, user_id, group_repository).role == ADMIN
    others = [m for m in group_repository.members(group_id) if str(m.user_id) != str(user_id)]
    # Se lee todo lo necesario ANTES de borrar: tras el commit las filas quedan expiradas.
    heir_id = others[0].user_id if others else None
    another_admin = any(m.role == ADMIN for m in others)
    group_repository.remove_member(group_id, user_id)
    if not others:
        keys = group_repository.media_keys(group_id)
        group_repository.delete(group_id)
        discard_files(keys, media_storage)
    elif was_admin and not another_admin:
        group_repository.set_role(group_id, heir_id, ADMIN)
    return {"left": True}
