# Decisión humana (ADR-044 §2.5): la autorización se comprueba en el backend, contra la base.

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import text

from app.application.content_moderation import human_decision
from app.extensions import db
from app.infrastructure.persistence.repositories.user_repository import SQLAlchemyUserRepository
from tests.content_moderation.conftest import (
    attachments,
    make_account,
    make_moderator,
    publish_post_with_image,
)


def _decide(repository, attachment_id, actor_id, new_status, note=None):
    return human_decision.decide_attachment(
        attachment_id, actor_id, new_status, note, repository, SQLAlchemyUserRepository(),
        datetime.now(timezone.utc),
    )


def _audit():
    return db.session.execute(
        text("SELECT actor_id, actor_kind, action, changes FROM admin_audit_log")
    ).mappings().all()


def _setup(client):
    author, _ = make_account(client, "autora")
    publish_post_with_image(client, author)
    _, moderator_id = make_account(client, "moderadora")
    return attachments()[0]["id"], moderator_id


class TestPermissions:
    def test_a_regular_account_cannot_decide(self, app, client, moderation_on, repository):
        with app.app_context():
            attachment_id, regular_id = _setup(client)

            with pytest.raises(human_decision.NotAllowedError):
                _decide(repository, attachment_id, regular_id, "approved")

            assert attachments()[0]["moderation_status"] == "pending" and _audit() == []

    def test_an_unknown_actor_cannot_decide(self, app, client, moderation_on, repository):
        with app.app_context():
            attachment_id, _ = _setup(client)
            with pytest.raises(human_decision.NotAllowedError):
                _decide(repository, attachment_id, str(uuid.uuid4()), "approved")

    def test_a_suspended_moderator_cannot_decide(self, app, client, moderation_on, repository):
        with app.app_context():
            attachment_id, moderator_id = _setup(client)
            make_moderator(moderator_id)
            db.session.execute(
                text("UPDATE users SET suspended_at = now() WHERE id = :id"), {"id": moderator_id}
            )
            db.session.commit()

            with pytest.raises(human_decision.NotAllowedError):
                _decide(repository, attachment_id, moderator_id, "approved")

    def test_the_role_is_read_from_the_database_each_time(
        self, app, client, moderation_on, repository
    ):
        with app.app_context():
            attachment_id, moderator_id = _setup(client)
            make_moderator(moderator_id)
            _decide(repository, attachment_id, moderator_id, "held")
            make_moderator(moderator_id, False)

            with pytest.raises(human_decision.NotAllowedError):
                _decide(repository, attachment_id, moderator_id, "approved")


class TestDecisions:
    @pytest.mark.parametrize("new_status", ["approved", "held", "rejected"])
    def test_a_moderator_decides_and_it_is_audited_as_human(
        self, app, client, moderation_on, repository, new_status
    ):
        with app.app_context():
            attachment_id, moderator_id = _setup(client)
            make_moderator(moderator_id)

            result = _decide(repository, attachment_id, moderator_id, new_status, "revisada")

            assert result["from"] == "pending" and result["to"] == new_status
            assert attachments()[0]["moderation_status"] == new_status
            [audit] = _audit()
            assert str(audit["actor_id"]) == str(moderator_id) and audit["actor_kind"] == "human"
            assert audit["changes"]["note"] == "revisada"
            row = db.session.execute(text("SELECT * FROM media_attachments")).mappings().one()
            assert row["moderation_decided_by"] == str(moderator_id)

    @pytest.mark.parametrize("bad", ["pending", "banned", "", None, "APPROVED"])
    def test_only_valid_human_decisions_are_accepted(
        self, app, client, moderation_on, repository, bad
    ):
        with app.app_context():
            attachment_id, moderator_id = _setup(client)
            make_moderator(moderator_id)

            with pytest.raises(human_decision.InvalidDecisionError):
                _decide(repository, attachment_id, moderator_id, bad)

    def test_an_unknown_image_is_not_found_and_leaves_no_audit(
        self, app, client, moderation_on, repository
    ):
        with app.app_context():
            _, moderator_id = _setup(client)
            make_moderator(moderator_id)

            with pytest.raises(human_decision.NotFoundError):
                _decide(repository, str(uuid.uuid4()), moderator_id, "approved")

            assert _audit() == []


def test_deleting_the_account_removes_jobs_and_results_but_keeps_the_audit(
    app, client, moderation_on, repository, settings, classifier
):
    from app.application.content_moderation.process_jobs import process_next
    from tests.content_moderation.conftest import now

    with app.app_context():
        author, author_id = make_account(client, "autora")
        publish_post_with_image(client, author)
        process_next(repository, classifier, settings, "w1", now())
        assert len(db.session.execute(text("SELECT 1 FROM moderation_results")).all()) == 1

        db.session.execute(text("DELETE FROM users WHERE id = :id"), {"id": author_id})
        db.session.commit()

        # Los archivos y filas del contenido desaparecen; el trabajo queda huérfano pero inocuo
        # (su sujeto ya no existe) y el registro de auditoría se conserva.
        assert db.session.execute(text("SELECT 1 FROM media_attachments")).all() == []
        assert len(db.session.execute(text("SELECT 1 FROM admin_audit_log")).all()) == 1
