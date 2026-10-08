# Adaptador SQLAlchemy del puerto `MediaAttachmentRepository`
# (domain/media/attachments.py). Único punto que traduce entre
# `media_attachments` (PostgreSQL) y el resto de las capas.

from sqlalchemy import select

from app.domain.media.attachments import MediaAttachmentRepository
from app.extensions import db
from app.infrastructure.persistence.models import MediaAttachment


class SQLAlchemyMediaAttachmentRepository(MediaAttachmentRepository):
    def _add(self, owner_id, items, **parent):
        for position, item in enumerate(items):
            db.session.add(
                MediaAttachment(
                    owner_id=owner_id,
                    storage_key=item["key"],
                    width=item["width"],
                    height=item["height"],
                    position=position,
                    **parent,
                )
            )
        db.session.commit()

    def add_for_post(self, post_id, owner_id, items):
        self._add(owner_id, items, post_id=post_id)

    def add_for_message(self, message_id, owner_id, items):
        self._add(owner_id, items, message_id=message_id)

    def keys_for_post(self, post_id, owner_id):
        return list(
            db.session.execute(
                select(MediaAttachment.storage_key).where(
                    MediaAttachment.post_id == post_id,
                    MediaAttachment.owner_id == owner_id,
                )
            ).scalars()
        )

    def keys_for_message(self, message_id, owner_id):
        return list(
            db.session.execute(
                select(MediaAttachment.storage_key).where(
                    MediaAttachment.message_id == message_id,
                    MediaAttachment.owner_id == owner_id,
                )
            ).scalars()
        )
