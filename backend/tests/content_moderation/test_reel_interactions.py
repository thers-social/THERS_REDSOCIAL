# Me gusta, guardados y comentarios de Reels (ADR-055). Mux simulado, PostgreSQL real.

import pytest
from sqlalchemy import text

from app.extensions import db
from tests.content_moderation.conftest import make_account
from tests.content_moderation.test_reels import (  # noqa: F401  (`reels` es una fixture)
    _approve,
    _setup_video,
    _to_ready,
    reels,
)
from tests.test_messages import _auth_headers


@pytest.fixture()
def published(app, client, reels):
    """Un Reel publicado (listo y aprobado) de `autora`, y una espectadora `otra`."""
    with app.app_context():
        token, owner_id, video_id, upload_id = _setup_video(client)
        _to_ready(client, video_id, upload_id)
        _approve(video_id)
        viewer_token, viewer_id = make_account(client, "otra")
        return {"owner": token, "owner_id": owner_id, "video": video_id,
                "viewer": viewer_token, "viewer_id": viewer_id}


def _post(client, token, path, **kw):
    return client.post(path, headers=_auth_headers(token), **kw)


def _get(client, token, path):
    return client.get(path, headers=_auth_headers(token))


class TestLikes:
    def test_like_is_idempotent_and_counted(self, app, client, published):
        with app.app_context():
            url = f"/api/videos/{published['video']}/like"
            first = _post(client, published["viewer"], url)
            again = _post(client, published["viewer"], url)
            assert first.status_code == again.status_code == 200
            assert again.get_json() == {"liked": True, "likes_count": 1}

    def test_unlike_removes_it_and_is_idempotent(self, app, client, published):
        with app.app_context():
            url = f"/api/videos/{published['video']}/like"
            _post(client, published["viewer"], url)
            r = client.delete(url, headers=_auth_headers(published["viewer"]))
            assert r.get_json() == {"liked": False, "likes_count": 0}
            r = client.delete(url, headers=_auth_headers(published["viewer"]))
            assert r.status_code == 200 and r.get_json()["likes_count"] == 0

    def test_the_feed_reports_my_state_and_counters(self, app, client, published):
        with app.app_context():
            _post(client, published["viewer"], f"/api/videos/{published['video']}/like")
            _post(client, published["viewer"], f"/api/videos/{published['video']}/save")
            video = _get(client, published["viewer"], "/api/videos").get_json()["videos"][0]
            assert video["liked_by_me"] is True and video["saved_by_me"] is True
            assert video["likes_count"] == 1 and video["comments_count"] == 0
            other = _get(client, published["owner"], "/api/videos").get_json()["videos"][0]
            assert other["liked_by_me"] is False and other["likes_count"] == 1

    def test_an_unpublished_video_cannot_be_liked(self, app, client, reels):
        with app.app_context():
            _, _, video_id, _ = _setup_video(client)
            viewer, _ = make_account(client, "otra")
            assert _post(client, viewer, f"/api/videos/{video_id}/like").status_code == 404

    def test_a_blocked_person_gets_a_404(self, app, client, published):
        with app.app_context():
            db.session.execute(
                text("INSERT INTO user_restrictions (owner_id, target_id, kind) VALUES (:o, :t, 'block')"),
                {"o": published["owner_id"], "t": published["viewer_id"]},
            )
            db.session.commit()
            assert _post(client, published["viewer"], f"/api/videos/{published['video']}/like").status_code == 404

    def test_requires_a_session(self, app, client, published):
        with app.app_context():
            assert client.post(f"/api/videos/{published['video']}/like").status_code == 401


class TestSaves:
    def test_save_list_and_unsave(self, app, client, published):
        with app.app_context():
            url = f"/api/videos/{published['video']}/save"
            assert _post(client, published["viewer"], url).get_json() == {"saved": True}
            saved = _get(client, published["viewer"], "/api/videos/saved").get_json()
            assert [v["id"] for v in saved["videos"]] == [published["video"]]
            assert _get(client, published["owner"], "/api/videos/saved").get_json()["videos"] == []
            assert client.delete(url, headers=_auth_headers(published["viewer"])).get_json() == {"saved": False}
            assert _get(client, published["viewer"], "/api/videos/saved").get_json()["videos"] == []


class TestComments:
    def test_create_list_and_count(self, app, client, published):
        with app.app_context():
            url = f"/api/videos/{published['video']}/comments"
            r = _post(client, published["viewer"], url, json={"content": "  Qué bueno  "})
            assert r.status_code == 201
            comment = r.get_json()["comment"]
            assert comment["content"] == "Qué bueno" and comment["author"]["username"] == "otra"
            assert comment["can_delete"] is True
            listed = _get(client, published["owner"], url).get_json()
            assert [c["id"] for c in listed["comments"]] == [comment["id"]]
            assert listed["comments"][0]["can_delete"] is True  # la persona dueña del Reel
            video = _get(client, published["viewer"], "/api/videos").get_json()["videos"][0]
            assert video["comments_count"] == 1

    @pytest.mark.parametrize("body", [{}, {"content": ""}, {"content": "   "}, {"content": 5},
                                      {"content": "x" * 1001}])
    def test_invalid_content_is_rejected(self, app, client, published, body):
        with app.app_context():
            r = _post(client, published["viewer"], f"/api/videos/{published['video']}/comments", json=body)
            assert r.status_code == 400

    def test_author_and_video_owner_can_delete_but_a_third_person_cannot(self, app, client, published):
        with app.app_context():
            url = f"/api/videos/{published['video']}/comments"
            third, _ = make_account(client, "tercera")
            mine = _post(client, published["viewer"], url, json={"content": "uno"}).get_json()["comment"]["id"]
            other = _post(client, third, url, json={"content": "dos"}).get_json()["comment"]["id"]
            assert client.delete(f"{url}/{other}", headers=_auth_headers(published["viewer"])).status_code == 404
            assert client.delete(f"{url}/{mine}", headers=_auth_headers(published["viewer"])).status_code == 200
            assert client.delete(f"{url}/{other}", headers=_auth_headers(published["owner"])).status_code == 200
            assert _get(client, published["owner"], url).get_json()["comments"] == []

    def test_comments_from_a_blocked_person_are_hidden(self, app, client, published):
        with app.app_context():
            url = f"/api/videos/{published['video']}/comments"
            _post(client, published["viewer"], url, json={"content": "hola"})
            db.session.execute(
                text("INSERT INTO user_restrictions (owner_id, target_id, kind) VALUES (:o, :t, 'block')"),
                {"o": published["owner_id"], "t": published["viewer_id"]},
            )
            db.session.commit()
            assert _get(client, published["owner"], url).get_json()["comments"] == []

    def test_deleting_the_video_removes_its_interactions(self, app, client, published):
        with app.app_context():
            _post(client, published["viewer"], f"/api/videos/{published['video']}/like")
            _post(client, published["viewer"], f"/api/videos/{published['video']}/comments", json={"content": "x"})
            assert client.delete(f"/api/videos/{published['video']}",
                                 headers=_auth_headers(published["owner"])).status_code == 200
            for table in ("video_likes", "video_comments"):
                assert db.session.execute(text(f"SELECT count(*) FROM {table}")).scalar() == 0

    def test_everything_is_404_while_the_module_is_off(self, app, client, published):
        with app.app_context():
            app.config["VIDEOS_ENABLED"] = False
            for path in ("/like", "/save", "/comments"):
                r = _post(client, published["viewer"], f"/api/videos/{published['video']}{path}",
                          json={"content": "x"})
                assert r.status_code == 404
