# Historias con moderación y almacenamiento privado (ADR-042, ADR-044). PostgreSQL real.
# Con los dos interruptores apagados Historias se comporta exactamente como antes.

import io
import os

import pytest
from sqlalchemy import text

from app.application.content_moderation.process_jobs import process_next
from app.extensions import db
from app.infrastructure.content_moderation.fake_classifiers import FakeImageClassifier
from tests.content_moderation.conftest import make_account, now, png
from tests.test_messages import _auth_headers

PRIVATE_PREFIX = "/api/private-documents/"


@pytest.fixture(autouse=True)
def _stories_on(app):
    app.config["STORIES_ENABLED"] = True


@pytest.fixture()
def private_on(app):
    app.config["STORIES_PRIVATE_STORAGE"] = True
    yield
    app.config["STORIES_PRIVATE_STORAGE"] = False


def _publish(client, token, content="hola"):
    return client.post(
        "/api/stories",
        data={"image": (io.BytesIO(png()), "foto.png"), "content": content},
        content_type="multipart/form-data",
        headers=_auth_headers(token),
    )


def _follow(client, token, target_id):
    client.post(f"/api/users/{target_id}/follow", headers=_auth_headers(token))


def _people(client):
    author, author_id = make_account(client, "autora")
    fan, fan_id = make_account(client, "seguidora")
    _follow(client, fan, author_id)
    return author, author_id, fan, fan_id


def _classify(repository, settings, scores):
    process_next(repository, FakeImageClassifier(default_scores=scores), settings, "w", now())


def _story_row():
    return db.session.execute(text("SELECT * FROM stories")).mappings().one()


def _their_stories(client, token, author_id):
    return client.get(f"/api/users/{author_id}/stories", headers=_auth_headers(token)).get_json()["stories"]


def _strip(client, token):
    return client.get("/api/stories", headers=_auth_headers(token)).get_json()["authors"]


class TestEverythingOffIsTheSameAsBefore:
    def test_a_public_story_keeps_its_shape_and_visibility(self, app, client):
        with app.app_context():
            author, author_id, fan, _ = _people(client)

            created = _publish(client, author).get_json()["story"]

            assert created["image"]["url"].startswith("http://testserver/api/media/stories/")
            assert "moderation_status" not in created
            assert _their_stories(client, fan, author_id)[0]["image"]["url"]
            row = _story_row()
            assert (row["moderation_status"], row["file_private"]) == ("approved", False)
            assert db.session.execute(text("SELECT count(*) FROM moderation_jobs")).scalar() == 0
            assert os.listdir(os.environ["UPLOAD_DIR"]) != []


class TestModeration:
    def test_a_new_story_is_pending_and_a_follower_does_not_see_it(
        self, app, client, moderation_on
    ):
        with app.app_context():
            author, author_id, fan, _ = _people(client)

            created = _publish(client, author).get_json()["story"]

            assert _story_row()["moderation_status"] == "pending"
            assert created["image"]["url"] is None and created["moderation_status"] == "pending"
            assert _their_stories(client, fan, author_id) == []
            assert _strip(client, fan) == []
            [job] = db.session.execute(text("SELECT * FROM moderation_jobs")).mappings().all()
            assert (job["subject_type"], str(job["subject_id"])) == ("story", str(_story_row()["id"]))

    def test_the_author_sees_it_with_its_status_and_no_url(self, app, client, moderation_on):
        with app.app_context():
            author, author_id, _, _ = _people(client)
            _publish(client, author)

            [story] = _their_stories(client, author, author_id)
            [entry] = _strip(client, author)

            assert story["image"]["url"] is None and story["moderation_status"] == "pending"
            assert entry["latest_image_url"] is None

    def test_a_follower_cannot_register_a_view_of_a_pending_story(self, app, client, moderation_on):
        with app.app_context():
            author, _, fan, _ = _people(client)
            story_id = str(_publish(client, author).get_json()["story"]["id"])

            r = client.post(f"/api/stories/{story_id}/view", headers=_auth_headers(fan))

            assert r.status_code == 404
            assert db.session.execute(text("SELECT count(*) FROM story_views")).scalar() == 0

    def test_approved_by_the_worker_becomes_visible(
        self, app, client, moderation_on, repository, settings
    ):
        with app.app_context():
            author, author_id, fan, _ = _people(client)
            _publish(client, author)

            _classify(repository, settings, {})

            assert _story_row()["moderation_status"] == "approved"
            [story] = _their_stories(client, fan, author_id)
            assert story["image"]["url"] and "moderation_status" not in story
            assert len(_strip(client, fan)) == 1
            audit = db.session.execute(text("SELECT resource_type, actor_kind FROM admin_audit_log")).one()
            assert tuple(audit) == ("story", "system")

    def test_a_doubtful_story_is_held_and_stays_hidden(
        self, app, client, moderation_on, repository, settings
    ):
        with app.app_context():
            author, author_id, fan, _ = _people(client)
            _publish(client, author)

            _classify(repository, settings, {"violence": 0.7})

            assert _story_row()["moderation_status"] == "held"
            assert _their_stories(client, fan, author_id) == []

    def test_the_public_file_is_not_served_while_pending(self, app, client, moderation_on):
        with app.app_context():
            author, _, _, _ = _people(client)
            _publish(client, author)
            key = _story_row()["storage_key"]

            assert client.get(f"/api/media/{key}").status_code == 404
            db.session.execute(text("UPDATE stories SET moderation_status = 'approved'"))
            db.session.commit()
            assert client.get(f"/api/media/{key}").status_code == 200


class TestPrivateStorage:
    def test_the_file_goes_to_the_private_store_never_the_public_one(
        self, app, client, private_on
    ):
        with app.app_context():
            author, _, _, _ = _people(client)
            before_public = set(os.listdir(os.environ["UPLOAD_DIR"]))

            created = _publish(client, author).get_json()["story"]

            row = _story_row()
            assert row["file_private"] is True
            assert not os.path.exists(os.path.join(os.environ["UPLOAD_DIR"], row["storage_key"]))
            assert os.path.exists(os.path.join(os.environ["PRIVATE_UPLOAD_DIR"], row["storage_key"]))
            assert set(os.listdir(os.environ["UPLOAD_DIR"])) == before_public
            assert PRIVATE_PREFIX in created["image"]["url"]
            assert row["storage_key"] not in created["image"]["url"]  # la clave no se filtra

    def test_a_follower_gets_a_signed_url_that_works_and_a_forged_one_does_not(
        self, app, client, private_on
    ):
        with app.app_context():
            author, author_id, fan, _ = _people(client)
            _publish(client, author)

            url = _their_stories(client, fan, author_id)[0]["image"]["url"]
            path = url[url.index("/api/"):]
            ok = client.get(path)
            assert ok.status_code == 200 and ok.mimetype == "image/webp"
            assert ok.headers["Cache-Control"] == "private, no-store"
            assert client.get(PRIVATE_PREFIX + "tampered-token").status_code == 404
            assert client.get(path[:-3] + "xyz").status_code == 404

    def test_a_non_follower_never_receives_a_url(self, app, client, private_on):
        with app.app_context():
            author, author_id, _, _ = _people(client)
            stranger, _ = make_account(client, "extrana")
            _publish(client, author)

            assert _their_stories(client, stranger, author_id) == []
            assert _strip(client, stranger) == []

    def test_a_private_story_pending_moderation_has_no_url_even_for_its_author(
        self, app, client, private_on, moderation_on
    ):
        with app.app_context():
            author, author_id, _, _ = _people(client)
            _publish(client, author)
            story = _their_stories(client, author, author_id)[0]
            assert story["image"]["url"] is None

    def test_without_a_private_store_publishing_fails_closed(self, app, client, private_on):
        with app.app_context():
            author, _, _, _ = _people(client)
            app.extensions["private_storage"] = None

            r = _publish(client, author)

            assert r.status_code == 503
            assert db.session.execute(text("SELECT count(*) FROM stories")).scalar() == 0
            assert os.listdir(os.environ["UPLOAD_DIR"]) == []

    def test_deleting_a_story_removes_its_private_file(self, app, client, private_on):
        with app.app_context():
            author, _, _, _ = _people(client)
            story_id = _publish(client, author).get_json()["story"]["id"]
            key = _story_row()["storage_key"]

            assert client.delete(f"/api/stories/{story_id}", headers=_auth_headers(author)).status_code == 200

            assert not os.path.exists(os.path.join(os.environ["PRIVATE_UPLOAD_DIR"], key))

    def test_purging_expired_stories_removes_private_and_public_files(self, app, client, private_on):
        from datetime import timedelta

        from app.application.stories.story_use_cases import purge_expired_stories
        from app.infrastructure.persistence.repositories.story_repository import (
            SQLAlchemyStoryRepository,
        )

        with app.app_context():
            author, _, _, _ = _people(client)
            _publish(client, author)
            key = _story_row()["storage_key"]
            db.session.execute(text("UPDATE stories SET expires_at = now() - interval '10 days'"))
            db.session.commit()

            deleted = purge_expired_stories(
                SQLAlchemyStoryRepository(), app.extensions["media_storage"],
                now=now() + timedelta(days=1), private_storage=app.extensions["private_storage"],
            )

            assert deleted == 1
            assert not os.path.exists(os.path.join(os.environ["PRIVATE_UPLOAD_DIR"], key))

    def test_deleting_the_account_removes_the_private_files_too(self, app, client, private_on):
        from app.infrastructure.persistence.repositories.account_deletion_repository import (
            SQLAlchemyAccountDeleter,
        )
        from app.infrastructure.persistence.repositories.rate_limit_repository import (
            SQLAlchemyRateLimitRepository,
        )

        with app.app_context():
            author, author_id, _, _ = _people(client)
            _publish(client, author)
            key = _story_row()["storage_key"]

            result = SQLAlchemyAccountDeleter(SQLAlchemyRateLimitRepository()).delete_account(author_id)

            assert key in result["private_keys"] and key not in result["media_keys"]


class TestLegacyAndFailClosed:
    def test_stories_that_existed_before_stay_visible_and_public(self, app, client, moderation_on):
        with app.app_context():
            author, author_id, fan, _ = _people(client)
            db.session.execute(text(
                "INSERT INTO stories (author_id, storage_key, width, height, expires_at, "
                "moderation_status, file_private) VALUES (:a, 'stories/old.webp', 1, 1, "
                "now() + interval '1 hour', 'approved', false)"), {"a": author_id})
            db.session.commit()

            [story] = _their_stories(client, fan, author_id)

            assert story["image"]["url"].endswith("/stories/old.webp")

    def test_a_row_inserted_without_a_status_is_pending(self, app, client):
        with app.app_context():
            _, author_id, _, _ = _people(client)
            status = db.session.execute(text(
                "INSERT INTO stories (author_id, storage_key, width, height, expires_at) "
                "VALUES (:a, 'stories/x.webp', 1, 1, now() + interval '1 hour') "
                "RETURNING moderation_status"), {"a": author_id}).scalar()
            db.session.commit()
            assert status == "pending"


class TestPanelForStories:
    @pytest.fixture()
    def staff(self, app, client, moderation_on):
        with app.app_context():
            token, user_id = make_account(client, "revisora")
            db.session.execute(text("UPDATE users SET is_moderator = true, moderation_role = 'reviewer' WHERE id = :i"), {"i": user_id})
            db.session.commit()
            yield token

    def _setup(self, client, repository, settings, scores):
        author, author_id, fan, _ = _people(client)
        _publish(client, author)
        _classify(repository, settings, scores)
        return author, author_id, fan, str(_story_row()["id"])

    def test_stories_have_their_own_queue_and_media_queue_stays_separate(
        self, app, client, staff, repository, settings
    ):
        with app.app_context():
            self._setup(client, repository, settings, {"violence": 0.7})
            stories = client.get("/api/moderation/media?type=story", headers=_auth_headers(staff)).get_json()
            media = client.get("/api/moderation/media", headers=_auth_headers(staff)).get_json()
            assert [i["parent_type"] for i in stories["items"]] == ["story"]
            assert stories["items"][0]["type"] == "story" and media["items"] == []
            assert client.get("/api/moderation/media?type=weird", headers=_auth_headers(staff)).status_code == 400

    def test_a_moderator_approves_a_story_and_the_follower_then_sees_it(
        self, app, client, staff, repository, settings
    ):
        with app.app_context():
            _, author_id, fan, story_id = self._setup(client, repository, settings, {"violence": 0.7})

            r = client.post(f"/api/moderation/media/{story_id}/decision?type=story",
                            json={"decision": "approved"}, headers=_auth_headers(staff))

            assert r.status_code == 200 and _story_row()["moderation_status"] == "approved"
            assert len(_their_stories(client, fan, author_id)) == 1
            trail = client.get(f"/api/moderation/media/{story_id}?type=story", headers=_auth_headers(staff)).get_json()["trail"]
            assert [t["actor_kind"] for t in trail] == ["system", "human"]

    def test_the_decision_without_the_story_type_does_not_touch_stories(
        self, app, client, staff, repository, settings
    ):
        with app.app_context():
            _, _, _, story_id = self._setup(client, repository, settings, {"violence": 0.7})
            r = client.post(f"/api/moderation/media/{story_id}/decision",
                            json={"decision": "approved"}, headers=_auth_headers(staff))
            assert r.status_code == 404 and _story_row()["moderation_status"] == "held"

    def test_a_private_story_is_previewed_through_a_short_signed_url(
        self, app, client, private_on, staff, repository, settings
    ):
        with app.app_context():
            _, _, _, story_id = self._setup(client, repository, settings, {"violence": 0.7})
            headers = _auth_headers(staff)

            direct = client.get(f"/api/moderation/media/{story_id}/file?type=story", headers=headers)
            signed = client.get(f"/api/moderation/media/{story_id}/preview-url?type=story", headers=headers)

            assert direct.status_code == 409
            body = signed.get_json()
            assert signed.status_code == 200 and body["expires_in"] == 300
            assert client.get(body["url"][body["url"].index("/api/"):]).status_code == 200
            assert client.get(f"/api/moderation/media/{story_id}/preview-url?type=story").status_code == 401

    def test_a_regular_account_cannot_get_a_preview_url(
        self, app, client, private_on, staff, repository, settings
    ):
        with app.app_context():
            author, _, _, story_id = self._setup(client, repository, settings, {"violence": 0.7})
            r = client.get(f"/api/moderation/media/{story_id}/preview-url?type=story", headers=_auth_headers(author))
            assert r.status_code == 404

    def test_the_author_can_appeal_a_held_story_and_overturning_publishes_it(
        self, app, client, staff, repository, settings
    ):
        with app.app_context():
            author, author_id, fan, story_id = self._setup(client, repository, settings, {"violence": 0.7})
            appeal = client.post("/api/appeals", json={"attachment_id": story_id, "type": "story", "reason": "error"},
                                 headers=_auth_headers(author))
            assert appeal.status_code == 201
            # Sin el tipo, el mismo identificador no es una imagen de publicación: 404.
            other = client.post("/api/appeals", json={"attachment_id": story_id, "reason": "error"},
                                headers=_auth_headers(author))
            assert other.status_code == 404
            appeal_id = db.session.execute(text("SELECT id FROM moderation_appeals")).scalar()

            r = client.post(f"/api/moderation/appeals/{appeal_id}/resolve", json={"outcome": "overturned"},
                            headers=_auth_headers(staff))

            assert r.status_code == 200 and _story_row()["moderation_status"] == "approved"
            assert len(_their_stories(client, fan, author_id)) == 1
            listed = client.get("/api/moderation/appeals?status=overturned", headers=_auth_headers(staff)).get_json()
            assert listed["items"][0]["type"] == "story"

    def test_stats_count_stories_and_media_together(self, app, client, staff, repository, settings):
        with app.app_context():
            self._setup(client, repository, settings, {"violence": 0.7})
            stats = client.get("/api/moderation/stats", headers=_auth_headers(staff)).get_json()
            assert stats["by_status"]["held"] == 1
