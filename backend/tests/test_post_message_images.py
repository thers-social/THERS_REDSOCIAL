# Pruebas de integración de las imágenes en publicaciones y mensajes (ADR-039)
# contra PostgreSQL real y almacenamiento local temporal (ver conftest.py).

import io
import os

from PIL import Image

from tests.test_messages import _auth_headers, _register_and_login

MEDIA_PREFIX = "http://testserver/api/media/"


def _png(width=40, height=30, color=(200, 30, 30)):
    out = io.BytesIO()
    Image.new("RGB", (width, height), color).save(out, format="PNG")
    return out.getvalue()


def _upload(raw, name="foto.png"):
    return io.BytesIO(raw), name


def _stored_files():
    files = []
    for folder, _, names in os.walk(os.environ["UPLOAD_DIR"]):
        files += [os.path.join(folder, name) for name in names]
    return files


def _key(url):
    assert url.startswith(MEDIA_PREFIX)
    return url[len(MEDIA_PREFIX):]


def _post(client, token, content="", images=(), **extra):
    data = {"content": content, **extra}
    if images:
        data["images"] = list(images)
    return client.post(
        "/api/posts", data=data, content_type="multipart/form-data", headers=_auth_headers(token)
    )


def _setup(client):
    token_a, id_a = _register_and_login(client, username="user_a", email="a@example.com")
    token_b, id_b = _register_and_login(client, username="user_b", email="b@example.com")
    return token_a, id_a, token_b, id_b


class TestPostImages:
    def test_publishes_a_post_with_an_image(self, client):
        token, *_ = _setup(client)

        response = _post(client, token, "Mi foto", [_upload(_png())])

        assert response.status_code == 201
        post = response.get_json()["post"]
        assert post["content"] == "Mi foto"
        assert len(post["images"]) == 1
        image = post["images"][0]
        assert (image["width"], image["height"]) == (40, 30)
        assert os.path.exists(os.path.join(os.environ["UPLOAD_DIR"], _key(image["url"])))

    def test_response_never_leaks_the_storage_key_or_owner(self, client):
        token, *_ = _setup(client)

        image = _post(client, token, "x", [_upload(_png())]).get_json()["post"]["images"][0]

        assert set(image) == {"url", "width", "height"}

    def test_an_image_alone_is_enough(self, client):
        token, *_ = _setup(client)

        response = _post(client, token, "", [_upload(_png())])

        assert response.status_code == 201
        assert response.get_json()["post"]["content"] == ""

    def test_without_image_the_text_is_still_required(self, client):
        token, *_ = _setup(client)

        response = _post(client, token, "   ")

        assert response.status_code == 400

    def test_the_image_is_served_publicly_as_webp(self, client):
        token, *_ = _setup(client)
        url = _post(client, token, "x", [_upload(_png())]).get_json()["post"]["images"][0]["url"]

        response = client.get("/api/media/" + _key(url))

        assert response.status_code == 200
        assert response.headers["Content-Type"] == "image/webp"
        assert response.headers["X-Content-Type-Options"] == "nosniff"

    def test_big_images_are_scaled_down_keeping_the_aspect_ratio(self, client):
        token, *_ = _setup(client)

        image = _post(client, token, "x", [_upload(_png(3200, 2000))]).get_json()["post"][
            "images"
        ][0]

        assert image["width"] == 1600
        assert image["height"] == 1000

    def test_small_images_are_not_enlarged(self, client):
        token, *_ = _setup(client)

        image = _post(client, token, "x", [_upload(_png(100, 50))]).get_json()["post"]["images"][
            0
        ]

        assert (image["width"], image["height"]) == (100, 50)

    def test_up_to_four_images_keep_their_order(self, client):
        token, *_ = _setup(client)
        sizes = [(10, 10), (20, 10), (30, 10), (40, 10)]

        response = _post(client, token, "x", [_upload(_png(w, h)) for w, h in sizes])

        assert response.status_code == 201
        widths = [image["width"] for image in response.get_json()["post"]["images"]]
        assert widths == [10, 20, 30, 40]

    def test_more_than_four_images_is_rejected_and_stores_nothing(self, client):
        token, *_ = _setup(client)

        response = _post(client, token, "x", [_upload(_png()) for _ in range(5)])

        assert response.status_code == 400
        assert _stored_files() == []

    def test_a_file_that_is_not_an_image_is_rejected_whole(self, client):
        token, *_ = _setup(client)

        response = _post(
            client, token, "x", [_upload(_png()), _upload(b"no soy una imagen", "x.png")]
        )

        assert response.status_code == 400
        assert _stored_files() == []
        feed = client.get("/api/posts", headers=_auth_headers(token)).get_json()["posts"]
        assert feed == []

    def test_validates_by_content_not_by_name_or_declared_type(self, client):
        token, *_ = _setup(client)

        response = _post(client, token, "x", [_upload(b"<?php echo 1; ?>", "foto.jpg")])

        assert response.status_code == 400

    def test_a_file_over_5mb_is_rejected(self, client):
        token, *_ = _setup(client)

        response = _post(client, token, "x", [_upload(b"0" * (5 * 1024 * 1024 + 10))])

        assert response.status_code == 413
        assert _stored_files() == []

    def test_hidden_payload_after_the_image_is_not_stored(self, client):
        token, *_ = _setup(client)
        raw = _png() + b"<script>alert(1)</script>"

        response = _post(client, token, "x", [_upload(raw)])

        assert response.status_code == 201
        stored = open(_stored_files()[0], "rb").read()
        assert b"<script>" not in stored

    def test_exif_is_not_kept(self, client):
        token, *_ = _setup(client)
        image = Image.new("RGB", (30, 20), (1, 2, 3))
        exif = Image.Exif()
        exif[0x010F] = "CamaraSecreta"
        out = io.BytesIO()
        image.save(out, format="JPEG", exif=exif)

        _post(client, token, "x", [_upload(out.getvalue(), "foto.jpg")])

        assert b"CamaraSecreta" not in open(_stored_files()[0], "rb").read()

    def test_feed_includes_images_and_empty_list_when_there_are_none(self, client):
        token, *_ = _setup(client)
        _post(client, token, "con foto", [_upload(_png())])
        _post(client, token, "sin foto")

        posts = client.get("/api/posts", headers=_auth_headers(token)).get_json()["posts"]

        by_content = {post["content"]: post for post in posts}
        assert len(by_content["con foto"]["images"]) == 1
        assert by_content["sin foto"]["images"] == []

    def test_editing_a_post_keeps_its_images(self, client):
        token, *_ = _setup(client)
        post = _post(client, token, "antes", [_upload(_png())]).get_json()["post"]

        response = client.patch(
            f"/api/posts/{post['id']}", json={"content": "después"}, headers=_auth_headers(token)
        )

        assert response.status_code == 200
        assert response.get_json()["post"]["images"] == post["images"]

    def test_deleting_the_post_deletes_the_files(self, client):
        token, *_ = _setup(client)
        post = _post(client, token, "x", [_upload(_png()), _upload(_png())]).get_json()["post"]
        assert len(_stored_files()) == 2

        response = client.delete(f"/api/posts/{post['id']}", headers=_auth_headers(token))

        assert response.status_code == 200
        assert _stored_files() == []

    def test_someone_else_cannot_delete_the_post_nor_its_files(self, client):
        token_a, _, token_b, _ = _setup(client)
        post = _post(client, token_a, "x", [_upload(_png())]).get_json()["post"]

        response = client.delete(f"/api/posts/{post['id']}", headers=_auth_headers(token_b))

        assert response.status_code == 404
        assert len(_stored_files()) == 1

    def test_json_posts_keep_working_without_images(self, client):
        token, *_ = _setup(client)

        response = client.post(
            "/api/posts", json={"content": "solo texto"}, headers=_auth_headers(token)
        )

        assert response.status_code == 201
        assert response.get_json()["post"]["images"] == []

    def test_requires_a_session(self, client):
        response = client.post(
            "/api/posts",
            data={"content": "x", "images": [_upload(_png())]},
            content_type="multipart/form-data",
        )

        assert response.status_code == 401
        assert _stored_files() == []

    def test_sensitive_flag_works_in_multipart(self, client):
        token, *_ = _setup(client)

        post = _post(client, token, "x", [_upload(_png())], is_sensitive="true").get_json()["post"]

        assert post["is_sensitive"] is True

    def test_uploads_are_rate_limited(self, client):
        token, *_ = _setup(client)
        tiny = _png(1, 1)

        statuses = [
            _post(client, token, "x", [_upload(tiny)]).status_code for _ in range(41)
        ]

        assert statuses[:40] == [201] * 40
        assert statuses[40] == 429


class TestMessageImages:
    def _send(self, client, token, to_id, content="", images=(), **extra):
        data = {"content": content, **extra}
        if images:
            data["images"] = list(images)
        return client.post(
            f"/api/users/{to_id}/messages",
            data=data,
            content_type="multipart/form-data",
            headers=_auth_headers(token),
        )

    def test_sends_a_message_with_an_image(self, client):
        token_a, _, _, id_b = _setup(client)

        response = self._send(client, token_a, id_b, "mira", [_upload(_png())])

        assert response.status_code == 201
        message = response.get_json()["message"]
        assert message["content"] == "mira"
        assert len(message["images"]) == 1

    def test_an_image_alone_is_enough(self, client):
        token_a, _, _, id_b = _setup(client)

        response = self._send(client, token_a, id_b, "", [_upload(_png())])

        assert response.status_code == 201

    def test_only_one_image_per_message(self, client):
        token_a, _, _, id_b = _setup(client)

        response = self._send(client, token_a, id_b, "x", [_upload(_png()), _upload(_png())])

        assert response.status_code == 400
        assert _stored_files() == []

    def test_the_thread_shows_the_image_to_both_people(self, client):
        token_a, _, token_b, id_b = _setup(client)
        id_a = client.get("/api/users/me", headers=_auth_headers(token_a)).get_json()["user"]["id"]
        self._send(client, token_a, id_b, "", [_upload(_png())])

        for token, other in ((token_a, id_b), (token_b, id_a)):
            messages = client.get(
                f"/api/users/{other}/messages", headers=_auth_headers(token)
            ).get_json()["messages"]
            assert len(messages[0]["images"]) == 1

    def test_the_conversation_list_flags_an_image_only_message(self, client):
        token_a, _, token_b, id_b = _setup(client)
        self._send(client, token_a, id_b, "", [_upload(_png())])

        conversations = client.get("/api/conversations", headers=_auth_headers(token_b)).get_json()[
            "conversations"
        ]

        assert conversations[0]["last_message"]["has_image"] is True
        assert conversations[0]["last_message"]["content"] == ""

    def test_a_text_message_has_no_images(self, client):
        token_a, _, _, id_b = _setup(client)

        message = client.post(
            f"/api/users/{id_b}/messages", json={"content": "hola"}, headers=_auth_headers(token_a)
        ).get_json()["message"]

        assert message["images"] == []

    def test_deleting_the_message_deletes_the_file(self, client):
        token_a, _, _, id_b = _setup(client)
        message = self._send(client, token_a, id_b, "", [_upload(_png())]).get_json()["message"]
        assert len(_stored_files()) == 1

        response = client.delete(f"/api/messages/{message['id']}", headers=_auth_headers(token_a))

        assert response.status_code == 200
        assert _stored_files() == []

    def test_the_recipient_cannot_delete_the_senders_message_or_file(self, client):
        token_a, _, token_b, id_b = _setup(client)
        message = self._send(client, token_a, id_b, "", [_upload(_png())]).get_json()["message"]

        response = client.delete(f"/api/messages/{message['id']}", headers=_auth_headers(token_b))

        assert response.status_code == 404
        assert len(_stored_files()) == 1

    def test_a_rejected_send_stores_nothing(self, client):
        token_a, id_a, _, _ = _setup(client)

        response = self._send(client, token_a, id_a, "", [_upload(_png())])

        assert response.status_code == 400
        assert _stored_files() == []

    def test_retrying_with_the_same_client_id_does_not_duplicate_the_image(self, client):
        token_a, _, _, id_b = _setup(client)

        first = self._send(client, token_a, id_b, "", [_upload(_png())], client_id="abc123")
        second = self._send(client, token_a, id_b, "", [_upload(_png())], client_id="abc123")

        assert first.status_code == 201
        assert second.status_code == 200
        assert second.get_json()["message"]["id"] == first.get_json()["message"]["id"]
        assert len(_stored_files()) == 1

    def test_invalid_file_is_rejected(self, client):
        token_a, _, _, id_b = _setup(client)

        response = self._send(client, token_a, id_b, "", [_upload(b"nada", "x.png")])

        assert response.status_code == 400
        assert _stored_files() == []


class TestAccountDeletionCollectsImages:
    def test_deleting_an_account_returns_the_image_keys_to_remove(self, client, app):
        token_a, id_a, token_b, id_b = _setup(client)
        post = _post(client, token_a, "x", [_upload(_png())]).get_json()["post"]
        message = client.post(
            f"/api/users/{id_b}/messages",
            data={"content": "", "images": [_upload(_png())]},
            content_type="multipart/form-data",
            headers=_auth_headers(token_a),
        ).get_json()["message"]
        expected = {_key(post["images"][0]["url"]), _key(message["images"][0]["url"])}

        from app.infrastructure.persistence.repositories.account_deletion_repository import (
            SQLAlchemyAccountDeleter,
        )
        from app.infrastructure.persistence.repositories.rate_limit_repository import (
            SQLAlchemyRateLimitRepository,
        )

        with app.app_context():
            result = SQLAlchemyAccountDeleter(SQLAlchemyRateLimitRepository()).delete_account(id_a)

        assert expected <= set(result["media_keys"])
