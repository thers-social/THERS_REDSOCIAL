# Adaptador SQLAlchemy del puerto `GroupRepository` (ADR-048).

import uuid

from sqlalchemy import and_, delete as sa_delete, func, select, update

from app.domain.groups.repositories import GroupRepository
from app.domain.groups.rules import ADMIN, MEMBER
from app.extensions import db
from app.infrastructure.persistence.models import (
    AudioAttachment,
    GroupChat,
    GroupMember,
    MediaAttachment,
    Message,
    VideoAttachment,
)


def _u(value):
    """Los ids llegan como str desde la capa de aplicación; el insert por lotes exige UUID."""
    return value if isinstance(value, uuid.UUID) else uuid.UUID(str(value))


class SQLAlchemyGroupRepository(GroupRepository):
    def create(self, name, creator_id, member_ids):
        group = GroupChat(name=name, created_by=_u(creator_id))
        db.session.add(group)
        db.session.flush()
        db.session.add(GroupMember(group_id=group.id, user_id=_u(creator_id), role=ADMIN))
        for user_id in member_ids:
            db.session.add(GroupMember(group_id=group.id, user_id=_u(user_id), role=MEMBER))
        db.session.commit()
        return group

    def get(self, group_id):
        return db.session.get(GroupChat, group_id)

    def membership(self, group_id, user_id):
        return db.session.get(GroupMember, (group_id, user_id))

    def members(self, group_id):
        return list(
            db.session.execute(
                select(GroupMember)
                .where(GroupMember.group_id == group_id)
                .order_by(GroupMember.joined_at, GroupMember.user_id)
            )
            .scalars()
            .unique()
        )

    def add_members(self, group_id, user_ids):
        present = {
            str(row)
            for row in db.session.execute(
                select(GroupMember.user_id).where(GroupMember.group_id == group_id)
            ).scalars()
        }
        added = [uid for uid in user_ids if str(uid) not in present]
        for user_id in added:
            db.session.add(GroupMember(group_id=_u(group_id), user_id=_u(user_id), role=MEMBER))
        db.session.commit()
        return added

    def remove_member(self, group_id, user_id):
        result = db.session.execute(
            sa_delete(GroupMember).where(
                GroupMember.group_id == group_id, GroupMember.user_id == user_id
            )
        )
        db.session.commit()
        return result.rowcount > 0

    def set_role(self, group_id, user_id, role):
        db.session.execute(
            update(GroupMember)
            .where(GroupMember.group_id == group_id, GroupMember.user_id == user_id)
            .values(role=role)
        )
        db.session.commit()

    def rename(self, group_id, name):
        db.session.execute(update(GroupChat).where(GroupChat.id == group_id).values(name=name))
        db.session.commit()

    def media_keys(self, group_id):
        keys = []
        for column, model in (
            (MediaAttachment.storage_key, MediaAttachment),
            (AudioAttachment.storage_key, AudioAttachment),
            (VideoAttachment.storage_key, VideoAttachment),
            (VideoAttachment.thumb_key, VideoAttachment),
        ):
            keys += list(
                db.session.execute(
                    select(column)
                    .join(Message, Message.id == model.message_id)
                    .where(Message.group_id == _u(group_id))
                ).scalars()
            )
        return keys

    def delete(self, group_id):
        db.session.execute(sa_delete(GroupChat).where(GroupChat.id == group_id))
        db.session.commit()

    def list_for_user(self, user_id):
        mine = db.session.execute(
            select(GroupChat)
            .join(GroupMember, GroupMember.group_id == GroupChat.id)
            .where(GroupMember.user_id == user_id)
        ).scalars().all()
        if not mine:
            return []
        group_ids = [group.id for group in mine]

        counts = dict(
            db.session.execute(
                select(GroupMember.group_id, func.count())
                .where(GroupMember.group_id.in_(group_ids))
                .group_by(GroupMember.group_id)
            ).all()
        )
        last_messages = {
            m.group_id: m
            for m in db.session.execute(
                select(Message)
                .where(Message.group_id.in_(group_ids))
                .distinct(Message.group_id)
                .order_by(Message.group_id, Message.created_at.desc())
            )
            .scalars()
            .unique()
        }
        # No leídos: mensajes de OTRAS personas posteriores a la última lectura de este miembro.
        unread = dict(
            db.session.execute(
                select(Message.group_id, func.count())
                .join(
                    GroupMember,
                    and_(GroupMember.group_id == Message.group_id, GroupMember.user_id == user_id),
                )
                .where(
                    Message.group_id.in_(group_ids),
                    Message.sender_id != user_id,
                    Message.created_at > GroupMember.last_read_at,
                )
                .group_by(Message.group_id)
            ).all()
        )

        rows = [
            {
                "group": group,
                "member_count": counts.get(group.id, 0),
                "last_message": last_messages.get(group.id),
                "unread_count": unread.get(group.id, 0),
            }
            for group in mine
        ]
        rows.sort(
            key=lambda r: (r["last_message"].created_at if r["last_message"] else r["group"].created_at),
            reverse=True,
        )
        return rows

    def list_messages_page(self, group_id, limit, hidden_sender_ids, before=None, after=None):
        query = select(Message).where(Message.group_id == group_id)
        if hidden_sender_ids:
            query = query.where(Message.sender_id.not_in([_u(h) for h in hidden_sender_ids]))

        if after is not None:
            query = query.where(Message.created_at >= after).order_by(
                Message.created_at.asc(), Message.id.asc()
            )
        else:
            if before is not None:
                query = query.where(Message.created_at <= before)
            query = query.order_by(Message.created_at.desc(), Message.id.desc())

        rows = db.session.execute(query.limit(limit + 1)).scalars().all()
        has_more = len(rows) > limit
        rows = rows[:limit]
        if after is None:
            rows = list(reversed(rows))
        return rows, has_more

    def mark_read(self, group_id, user_id):
        db.session.execute(
            update(GroupMember)
            .where(GroupMember.group_id == group_id, GroupMember.user_id == user_id)
            .values(last_read_at=func.now())
        )
        db.session.commit()
