# Adaptador SQLAlchemy del puerto `AudioAttachmentRepository` (domain/media/audio.py). Único punto
# que traduce entre `audio_attachments` (PostgreSQL) y el resto de las capas (ADR-042).

from sqlalchemy import select

from app.domain.media.audio import AudioAttachmentRepository
from app.extensions import db
from app.infrastructure.persistence.models import AudioAttachment


class SQLAlchemyAudioAttachmentRepository(AudioAttachmentRepository):
    def add_for_message(self, message_id, owner_id, item):
        db.session.add(
            AudioAttachment(
                owner_id=owner_id,
                message_id=message_id,
                storage_key=item["key"],
                duration_ms=item["duration_ms"],
                size_bytes=item["size_bytes"],
            )
        )
        db.session.commit()

    def keys_for_message(self, message_id, owner_id):
        return list(
            db.session.execute(
                select(AudioAttachment.storage_key).where(
                    AudioAttachment.message_id == message_id,
                    AudioAttachment.owner_id == owner_id,
                )
            ).scalars()
        )
