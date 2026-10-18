# Adaptador SQLAlchemy del puerto `VideoAttachmentRepository` (domain/media/video.py). Único punto
# que traduce entre `video_attachments` (PostgreSQL) y el resto de las capas (ADR-046).

from sqlalchemy import select

from app.domain.media.video import VideoAttachmentRepository
from app.extensions import db
from app.infrastructure.persistence.models import VideoAttachment


def _row(owner_id, item, **target):
    return VideoAttachment(
        owner_id=owner_id,
        storage_key=item["key"],
        thumb_key=item["thumb_key"],
        width=item["width"],
        height=item["height"],
        duration_ms=item["duration_ms"],
        size_bytes=item["size_bytes"],
        **target,
    )


class SQLAlchemyVideoAttachmentRepository(VideoAttachmentRepository):
    def add_for_post(self, post_id, owner_id, item):
        db.session.add(_row(owner_id, item, post_id=post_id))
        db.session.commit()

    def add_for_message(self, message_id, owner_id, item):
        db.session.add(_row(owner_id, item, message_id=message_id))
        db.session.commit()

    def _keys(self, column, value, owner_id):
        rows = db.session.execute(
            select(VideoAttachment.storage_key, VideoAttachment.thumb_key).where(
                column == value, VideoAttachment.owner_id == owner_id
            )
        ).all()
        return [key for row in rows for key in row]

    def keys_for_post(self, post_id, owner_id):
        return self._keys(VideoAttachment.post_id, post_id, owner_id)

    def keys_for_message(self, message_id, owner_id):
        return self._keys(VideoAttachment.message_id, message_id, owner_id)
