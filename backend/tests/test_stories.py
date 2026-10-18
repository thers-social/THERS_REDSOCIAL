# Pruebas de integración de las historias de 24 horas (ADR-042) contra PostgreSQL real y
# almacenamiento local temporal (ver conftest.py).

import io
import os
from datetime import datetime, timedelta, timezone

from PIL import Image
from sqlalchemy import text

from app.extensions import db
from tests.test_messages import _auth_headers, _register_and_login

MEDIA_PREFIX = "http://testserver/api/media/"


def _png(width=40, height=30):
    out = io.BytesIO()
    Image.new("RGB", (width, height), (10, 120, 200)).save(out, format="PNG")
    return out.getvalue()


def _stored_files():
    files = []
    for folder, _, names in os.walk(os.environ["UPLOAD_DIR"]):
        files += [os.path.join(folder, name) for name in names]
    return files


def _publish(client, token, content=None, raw=None, name="foto.png"):
    data = {"image": (io.BytesIO(raw if raw is not None else _png()), name)}
    if content is not None:
        data["content"] = content
    return client.post(
        "/api/stories", data=data, content_type="multipart/form-data", headers=_auth_headers(token)
    )


def _users(client):
    token_a, id_a = _register_and_login(client, username="user_a", email="a@example.com")
    token_b, id_b = _register_and_login(client, username="user_b", email="b@example.com")
    return token_a, id_a, token_b, id_b


def _follow(client, token, target_id):
    return client.post(f"/api/users/{target_id}/follow", headers=_auth_headers(token))


def _strip(client, token):
    return client.get("/api/stories", headers=_auth_headers(token)).get_json()["authors"]


def _expire(app, story_id, hours_ago=1):
    """Fuerza el vencimiento sin esperar 24 h: el reloj de la prueba es la columna guardada."""
    with app.app_context():
        db.session.execute(
            text("UPDATE stories SET expires_at = :t WHERE id = CAST(:i AS uuid)"),
            {"t": datetime.now(timezone.utc) - timedelta(hours=hours_ago), "i": story_id},
        )
        db.session.commit()


class TestPublish:
    def test_publishes_a_story_with_text(self, client):
        token, *_ = _users(client)

        response = _publish(client, token, "Buenos días")

        assert response.status_code == 201
        story = response.get_json()["story"]
        assert story["content"] == "Buenos días"
        assert (story["image"]["width"], story["image"]["height"]) == (40, 30)
        assert story["image"]["url"].startswith(MEDIA_PREFIX + "stories/")
        assert os.path.exists(
            os.path.join(os.environ["UPLOAD_DIR"], story["image"]["url"][len(MEDIA_PREFIX):])
        )

    def test_expires_in_24_hours(self, client):
        token, *_ = _users(client)

        story = _publish(client, token).get_json()["story"]

        created = datetime.fromisoformat(story["created_at"])
        expires = datetime.fromisoformat(story["expires_at"])
        assert expires - created > timedelta(hours=23, minutes=59)
        assert expires - created < timedelta(hours=24, minutes=1)

    def test_response_never_leaks_the_storage_key(self, client):
        token, *_ = _users(client)

        story = _publish(client, token).get_json()["story"]

        assert set(story["image"]) == {"url", "width", "height"}
        assert "storage_key" not in story

    def test_text_is_optional(self, client):
        token, *_ = _users(client)

        assert _publish(client, token).get_json()["story"]["content"] is None
        assert _publish(client, token, "   ").get_json()["story"]["content"] is None

    def test_rejects_text_over_200_characters(self, client):
        token, *_ = _users(client)

        response = _publish(client, token, "x" * 201)

        assert response.status_code == 400
        assert _stored_files() == []

    def test_requires_an_image(self, client):
        token, *_ = _users(client)

        response = client.post(
            "/api/stories",
            data={"content": "sin foto"},
            content_type="multipart/form-data",
            headers=_auth_headers(token),
        )

        assert response.status_code == 400

    def test_rejects_json_bodies(self, client):
        token, *_ = _users(client)

        response = client.post(
            "/api/stories", json={"content": "x"}, headers=_auth_headers(token)
        )

        assert response.status_code == 400

    def test_rejects_a_file_that_is_not_an_image(self, client):
        token, *_ = _users(client)

        response = _publish(client, token, raw=b"no soy una imagen", name="evil.png")

        assert response.status_code == 400
        assert _stored_files() == []

    def test_requires_authentication(self, client):
        response = client.post("/api/stories")

        assert response.status_code == 401

    def test_daily_limit_is_20(self, client):
        token, *_ = _users(client)

        for _ in range(20):
            assert _publish(client, token).status_code == 201
        response = _publish(client, token)

        assert response.status_code == 429
        assert "Retry-After" in response.headers


class TestVisibility:
    def test_a_story_is_not_visible_to_someone_who_does_not_follow(self, client):
        token_a, id_a, token_b, _ = _users(client)
        _publish(client, token_a)

        assert _strip(client, token_b) == []
        listing = client.get(f"/api/users/{id_a}/stories", headers=_auth_headers(token_b))
        assert listing.status_code == 200
        assert listing.get_json()["stories"] == []

    def test_a_follower_sees_the_story(self, client):
        token_a, id_a, token_b, _ = _users(client)
        _publish(client, token_a, "Hola")
        _follow(client, token_b, id_a)

        authors = _strip(client, token_b)

        assert [a["author"]["username"] for a in authors] == ["user_a"]
        assert authors[0]["stories_count"] == 1
        assert authors[0]["has_unseen"] is True
        listing = client.get(f"/api/users/{id_a}/stories", headers=_auth_headers(token_b))
        assert [s["content"] for s in listing.get_json()["stories"]] == ["Hola"]

    def test_the_strip_carries_the_latest_image_for_the_card(self, client):
        token_a, id_a, token_b, _ = _users(client)
        _publish(client, token_a)
        second = _publish(client, token_a).get_json()["story"]["image"]["url"]
        _follow(client, token_b, id_a)

        authors = _strip(client, token_b)

        assert authors[0]["latest_image_url"] == second

    def test_the_author_sees_their_own_story_first_and_never_unseen(self, client):
        token_a, id_a, token_b, id_b = _users(client)
        _publish(client, token_a, "mía")
        _publish(client, token_b, "de bob")
        _follow(client, token_a, id_b)

        authors = _strip(client, token_a)

        assert [a["is_me"] for a in authors] == [True, False]
        assert authors[0]["has_unseen"] is False

    def test_a_pending_follow_request_does_not_grant_access(self, client):
        token_a, id_a, token_b, _ = _users(client)
        client.patch("/api/users/me/privacy", json={"is_private": True}, headers=_auth_headers(token_a))
        _publish(client, token_a)
        response = _follow(client, token_b, id_a)
        assert response.get_json()["follow_status"] == "pending"

        assert _strip(client, token_b) == []

    def test_a_block_hides_the_story_in_both_directions(self, client):
        token_a, id_a, token_b, id_b = _users(client)
        _publish(client, token_a)
        _publish(client, token_b)
        _follow(client, token_b, id_a)
        _follow(client, token_a, id_b)

        client.post("/api/users/me/blocks", json={"user_id": id_b}, headers=_auth_headers(token_a))

        assert [a["author"]["username"] for a in _strip(client, token_a)] == ["user_a"]
        assert [a["author"]["username"] for a in _strip(client, token_b)] == ["user_b"]

    def test_an_expired_story_is_not_listed(self, app, client):
        token_a, id_a, token_b, _ = _users(client)
        story_id = _publish(client, token_a).get_json()["story"]["id"]
        _follow(client, token_b, id_a)
        assert len(_strip(client, token_b)) == 1

        _expire(app, story_id)

        assert _strip(client, token_b) == []
        assert _strip(client, token_a) == []
        listing = client.get(f"/api/users/{id_a}/stories", headers=_auth_headers(token_b))
        assert listing.get_json()["stories"] == []

    def test_an_unknown_user_returns_an_empty_list(self, client):
        token_a, *_ = _users(client)

        response = client.get(
            "/api/users/00000000-0000-0000-0000-000000000000/stories",
            headers=_auth_headers(token_a),
        )

        assert response.status_code == 200
        assert response.get_json()["stories"] == []


class TestViews:
    def test_records_a_view_and_clears_unseen(self, client):
        token_a, id_a, token_b, _ = _users(client)
        story_id = _publish(client, token_a).get_json()["story"]["id"]
        _follow(client, token_b, id_a)

        response = client.post(f"/api/stories/{story_id}/view", headers=_auth_headers(token_b))

        assert response.status_code == 200
        assert _strip(client, token_b)[0]["has_unseen"] is False
        listing = client.get(f"/api/users/{id_a}/stories", headers=_auth_headers(token_b))
        assert listing.get_json()["stories"][0]["seen_by_me"] is True

    def test_a_view_is_idempotent(self, client):
        token_a, id_a, token_b, _ = _users(client)
        story_id = _publish(client, token_a).get_json()["story"]["id"]
        _follow(client, token_b, id_a)

        for _ in range(3):
            assert (
                client.post(f"/api/stories/{story_id}/view", headers=_auth_headers(token_b)).status_code
                == 200
            )

        views = client.get(f"/api/stories/{story_id}/views", headers=_auth_headers(token_a))
        assert views.get_json()["views_count"] == 1

    def test_only_the_author_sees_who_viewed(self, client):
        token_a, id_a, token_b, _ = _users(client)
        story_id = _publish(client, token_a).get_json()["story"]["id"]
        _follow(client, token_b, id_a)
        client.post(f"/api/stories/{story_id}/view", headers=_auth_headers(token_b))

        mine = client.get(f"/api/stories/{story_id}/views", headers=_auth_headers(token_a))
        theirs = client.get(f"/api/stories/{story_id}/views", headers=_auth_headers(token_b))

        assert [v["username"] for v in mine.get_json()["views"]] == ["user_b"]
        assert theirs.status_code == 404

    def test_the_author_viewing_their_own_story_does_not_count(self, client):
        token_a, *_ = _users(client)
        story_id = _publish(client, token_a).get_json()["story"]["id"]

        client.post(f"/api/stories/{story_id}/view", headers=_auth_headers(token_a))

        views = client.get(f"/api/stories/{story_id}/views", headers=_auth_headers(token_a))
        assert views.get_json()["views_count"] == 0

    def test_a_stranger_cannot_view_it_and_gets_the_same_404_as_a_missing_story(self, client):
        token_a, _, token_b, _ = _users(client)
        story_id = _publish(client, token_a).get_json()["story"]["id"]

        hidden = client.post(f"/api/stories/{story_id}/view", headers=_auth_headers(token_b))
        missing = client.post(
            "/api/stories/00000000-0000-0000-0000-000000000000/view", headers=_auth_headers(token_b)
        )

        assert hidden.status_code == missing.status_code == 404
        assert hidden.get_json() == missing.get_json()

    def test_cannot_view_an_expired_story(self, app, client):
        token_a, id_a, token_b, _ = _users(client)
        story_id = _publish(client, token_a).get_json()["story"]["id"]
        _follow(client, token_b, id_a)
        _expire(app, story_id)

        response = client.post(f"/api/stories/{story_id}/view", headers=_auth_headers(token_b))

        assert response.status_code == 404


class TestDelete:
    def test_author_deletes_the_story_and_its_file(self, client):
        token_a, *_ = _users(client)
        story_id = _publish(client, token_a).get_json()["story"]["id"]
        assert len(_stored_files()) == 1

        response = client.delete(f"/api/stories/{story_id}", headers=_auth_headers(token_a))

        assert response.status_code == 200
        assert _strip(client, token_a) == []
        assert _stored_files() == []

    def test_someone_else_gets_404_and_nothing_is_deleted(self, client):
        token_a, _, token_b, _ = _users(client)
        story_id = _publish(client, token_a).get_json()["story"]["id"]

        response = client.delete(f"/api/stories/{story_id}", headers=_auth_headers(token_b))

        assert response.status_code == 404
        assert len(_strip(client, token_a)) == 1
        assert len(_stored_files()) == 1

    def test_deleting_twice_returns_404(self, client):
        token_a, *_ = _users(client)
        story_id = _publish(client, token_a).get_json()["story"]["id"]
        client.delete(f"/api/stories/{story_id}", headers=_auth_headers(token_a))

        response = client.delete(f"/api/stories/{story_id}", headers=_auth_headers(token_a))

        assert response.status_code == 404


class TestPurge:
    def test_purge_removes_rows_and_files_after_the_grace_period(self, app, client):
        from app.application.stories.story_use_cases import purge_expired_stories
        from app.infrastructure.persistence.repositories.story_repository import (
            SQLAlchemyStoryRepository,
        )

        token_a, *_ = _users(client)
        old_id = _publish(client, token_a).get_json()["story"]["id"]
        recent_id = _publish(client, token_a).get_json()["story"]["id"]
        keep_id = _publish(client, token_a).get_json()["story"]["id"]
        _expire(app, old_id, hours_ago=10)  # pasó el margen de 6 h
        _expire(app, recent_id, hours_ago=1)  # vencida, pero dentro del margen: el archivo se queda
        assert len(_stored_files()) == 3

        with app.app_context():
            deleted = purge_expired_stories(
                SQLAlchemyStoryRepository(), app.extensions["media_storage"]
            )

        assert deleted == 1
        assert len(_stored_files()) == 2
        with app.app_context():
            count = db.session.execute(text("SELECT count(*) FROM stories")).scalar_one()
        assert count == 2
        assert keep_id and recent_id


class TestAccountDeletion:
    def test_deleting_the_account_removes_the_story_files(self, app, client):
        token_a, *_ = _users(client)
        _publish(client, token_a)
        assert len(_stored_files()) == 1

        from app.infrastructure.persistence.repositories.account_deletion_repository import (
            SQLAlchemyAccountDeleter,
        )
        from app.infrastructure.persistence.repositories.rate_limit_repository import (
            SQLAlchemyRateLimitRepository,
        )

        with app.app_context():
            user_id = db.session.execute(
                text("SELECT id FROM users WHERE username = 'user_a'")
            ).scalar_one()
            result = SQLAlchemyAccountDeleter(SQLAlchemyRateLimitRepository()).delete_account(
                user_id
            )
            remaining = db.session.execute(text("SELECT count(*) FROM stories")).scalar_one()

        assert len(result["media_keys"]) == 1
        assert result["media_keys"][0].startswith("stories/")
        assert remaining == 0


class TestDataExport:
    def test_export_includes_own_stories_and_the_ones_viewed(self, client):
        import json
        import zipfile

        token_a, id_a, token_b, _ = _users(client)
        story_id = _publish(client, token_a, "mi historia").get_json()["story"]["id"]
        _follow(client, token_b, id_a)
        client.post(f"/api/stories/{story_id}/view", headers=_auth_headers(token_b))

        def _export(token):
            created = client.post("/api/data-exports", headers=_auth_headers(token))
            assert created.status_code == 201
            download = client.get(
                f"/api/data-exports/{created.get_json()['export']['id']}/download",
                headers=_auth_headers(token),
            )
            return zipfile.ZipFile(io.BytesIO(download.data))

        mine = _export(token_a)
        stories = json.loads(mine.read("stories.json"))
        assert [(s["content"], s["views_count"]) for s in stories] == [("mi historia", 1)]
        assert "storage_key" not in mine.read("stories.json").decode("utf-8")

        theirs = _export(token_b)
        assert json.loads(theirs.read("stories.json")) == []
        assert [v["story_id"] for v in json.loads(theirs.read("story_views.json"))] == [story_id]
