# Adaptador SQLAlchemy del puerto `MediaAttachmentRepository`
# (domain/media/attachments.py). Único punto que traduce entre
# `media_attachments` (PostgreSQL) y el resto de las capas.

from flask import current_app
from sqlalchemy import select

from app.domain.content_moderation import jobs as moderation_jobs
from app.domain.content_moderation.status import initial_status
from app.domain.media.attachments import MediaAttachmentRepository
from app.extensions import db
from app.infrastructure.persistence.models import MediaAttachment


class SQLAlchemyMediaAttachmentRepository(MediaAttachmentRepository):
    def _add(self, owner_id, items, **parent):
        # Moderación (ADR-044): el estado se fija SIEMPRE de forma explícita, y el trabajo de
        # revisión se encola en la MISMA transacción que la imagen (sin imagen sin trabajo).
        moderated = bool(current_app.config.get("MODERATION_ENABLED"))
        status = initial_status(moderated)
        queue = None
        if moderated:
            from app.infrastructure.persistence.repositories.content_moderation_repository import (
                SQLAlchemyContentModerationRepository,
            )

            queue = SQLAlchemyContentModerationRepository()
        for position, item in enumerate(items):
            attachment = MediaAttachment(
                owner_id=owner_id,
                storage_key=item["key"],
                width=item["width"],
                height=item["height"],
                position=position,
                moderation_status=status,
                **parent,
            )
            db.session.add(attachment)
            if queue is not None:
                db.session.flush()
                queue.enqueue(
                    moderation_jobs.KIND_IMAGE, moderation_jobs.SUBJECT_MEDIA_ATTACHMENT,
                    attachment.id,
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
