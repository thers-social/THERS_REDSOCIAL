# Videos cortos en publicaciones y mensajes (ADR-046), contra PostgreSQL real y almacenamiento local
# temporal (ver conftest.py). Los videos se generan con PyAV (tests/video_fixtures.py).

import io
import os

import av
import pytest
from PIL import Image
from sqlalchemy import text

from app.domain.media.video import (
    MAX_VIDEO_UPLOAD_BYTES,
    InvalidVideoError,
    VideoTooLargeError,
    VideoTooLongError,
)
from app.extensions import db
from app.infrastructure.media.video_processor import output_size, process_video, sniff_container
from tests.test_messages import _auth_headers, _register_and_login
from tests.video_fixtures import make_video, video_info

MEDIA_PREFIX = "http://testserver/api/media/"


def _key(url):
    assert url.startswith(MEDIA_PREFIX)
    return url[len(MEDIA_PREFIX):]


def _stored_files():
    files = []
    for folder, _, names in os.walk(os.environ["UPLOAD_DIR"]):
        files += [os.path.join(folder, name) for name in names]
    return files


# --- Procesado (sin base de datos) ----------------------------------------------------------------


class TestProcessor:
    def test_a_small_mp4_comes_out_as_h264_aac_with_a_thumbnail(self):
        mp4, content_type, thumbnail, width, height, duration_ms = process_video(make_video(320, 240, 1.0))

        assert content_type == "video/mp4"
        assert mp4[4:8] == b"ftyp"
        assert (width, height) == (320, 240)
        assert 950 <= duration_ms <= 1100
        assert video_info(mp4)[3:] == (True, "h264")
        image = Image.open(io.BytesIO(thumbnail))
        assert image.format == "WEBP" and image.size == (320, 240)

    def test_a_video_without_sound_is_accepted(self):
        mp4, *_ = process_video(make_video(160, 120, 1.0, audio=False))
        assert video_info(mp4)[3] is False

    def test_webm_is_accepted_and_normalised_to_mp4(self):
        raw = make_video(160, 120, 1.0, container="webm", codec="libvpx-vp9", audio=False)
        assert sniff_container(raw) == "matroska,webm"

        mp4, *_ = process_video(raw)

        assert mp4[4:8] == b"ftyp" and video_info(mp4)[4] == "h264"

    def test_big_frames_are_scaled_down_to_720p_without_stretching(self):
        _, _, _, width, height, _ = process_video(make_video(1920, 1080, 1.0))
        assert (width, height) == (1280, 720)

    def test_a_small_video_is_never_enlarged(self):
        assert output_size(160, 120) == (160, 120)

    @pytest.mark.parametrize(
        "size,expected",
        [((1920, 1080), (1280, 720)), ((1080, 1920), (720, 1280)), ((1001, 563), (1000, 562)), ((3840, 2160), (1280, 720))],
    )
    def test_output_sizes_fit_the_box_and_are_even(self, size, expected):
        out = output_size(*size)
        assert out == expected
        assert out[0] % 2 == 0 and out[1] % 2 == 0

    def test_high_frame_rates_are_capped_at_30(self):
        mp4, *_ = process_video(make_video(160, 120, 2.0, fps=60))
        source = av.open(io.BytesIO(mp4), format="mp4")
        assert float(source.streams.video[0].average_rate) <= 30.5
        source.close()

    @pytest.mark.parametrize("rotation,corner", [(0, "top-left"), (90, "bottom-left"), (180, "bottom-right"), (270, "top-right")])
    def test_a_rotated_phone_video_comes_out_upright(self, rotation, corner):
        raw = _marked_video(rotation)

        mp4, _, _, width, height, _ = process_video(raw)

        # Un video grabado de lado se entrega ya derecho: sin metadatos de rotación y con el marcador
        # rojo (arriba a la izquierda en la fuente) donde corresponde.
        assert (width, height) == ((120, 160) if rotation in (90, 270) else (160, 120))
        assert _red_corner(mp4) == corner

    def test_the_container_is_recognised_by_header_not_by_name(self):
        assert sniff_container(make_video(160, 120, 0.2)) == "mp4"
        for junk in (b"", b"hola", b"\x89PNG\r\n\x1a\n" + b"0" * 20, b"%PDF-1.7", b"MZ" + b"0" * 30, b"RIFF" + b"0" * 20):
            assert sniff_container(junk) is None

    @pytest.mark.parametrize(
        "junk",
        [b"", b"hola mundo" * 200, b"\x89PNG\r\n\x1a\n" + b"0" * 100, b"%PDF-1.7 " + b"0" * 100],
        ids=["empty", "text", "png", "pdf"],
    )
    def test_anything_that_is_not_a_video_is_rejected(self, junk):
        with pytest.raises(InvalidVideoError):
            process_video(junk)

    def test_a_truncated_video_is_rejected_not_crashed(self):
        good = make_video(160, 120, 1.0)
        with pytest.raises(InvalidVideoError):
            process_video(good[:12] + b"\x00" * 200)

    def test_an_audio_only_file_is_rejected(self):
        from tests.audio_fixtures import make_audio

        with pytest.raises(InvalidVideoError):
            process_video(make_audio("mp4", "aac", 1.0))

    def test_a_file_over_the_size_limit_is_rejected_before_decoding(self):
        with pytest.raises(VideoTooLargeError):
            process_video(b"\x00\x00\x00\x18ftypmp42" + b"0" * MAX_VIDEO_UPLOAD_BYTES)

    def test_a_video_over_a_minute_is_rejected(self):
        # Pocos fotogramas por segundo y poca resolución para que generarlo sea rápido.
        raw = make_video(64, 48, 65.0, fps=2, audio=False)
        with pytest.raises(VideoTooLongError):
            process_video(raw)

    def test_exactly_a_minute_is_accepted(self):
        _, _, _, _, _, duration_ms = process_video(make_video(64, 48, 60.0, fps=2, audio=False))
        assert 59_000 <= duration_ms <= 60_600


def _marked_video(rotation, width=160, height=120):
    """Video con un cuadrado rojo en la esquina superior izquierda del fotograma almacenado."""
    from fractions import Fraction

    buffer = io.BytesIO()
    out = av.open(buffer, "w", format="mp4")
    stream = out.add_stream("libx264", rate=30)
    stream.width, stream.height = width, height
    stream.pix_fmt = "yuv420p"
    if rotation:
        stream.set_display_rotation(rotation)
    for index in range(30):
        image = Image.new("RGB", (width, height), (0, 0, 255))
        image.paste((255, 0, 0), (0, 0, 40, 40))
        frame = av.VideoFrame.from_image(image)
        frame.pts = index
        frame.time_base = Fraction(1, 30)
        for packet in stream.encode(frame):
            out.mux(packet)
    for packet in stream.encode(None):
        out.mux(packet)
    out.close()
    return buffer.getvalue()


def _red_corner(mp4):
    source = av.open(io.BytesIO(mp4), format="mp4")
    image = next(source.decode(video=0)).to_image()
    source.close()
    w, h = image.size
    points = {"top-left": (5, 5), "top-right": (w - 5, 5), "bottom-left": (5, h - 5), "bottom-right": (w - 5, h - 5)}
    return [name for name, xy in points.items() if image.getpixel(xy)[0] > 150 and image.getpixel(xy)[2] < 100][0]


# --- API -----------------------------------------------------------------------------------------


@pytest.fixture()
def video_on(app):
    app.config.update(VIDEO_UPLOADS_ENABLED=True)


def _setup(client):
    token_a, id_a = _register_and_login(client, username="user_a", email="a@example.com")
    token_b, id_b = _register_and_login(client, username="user_b", email="b@example.com")
    return token_a, id_a, token_b, id_b


def _mp4(seconds=1.0):
    return make_video(160, 120, seconds)


def _post(client, token, video=None, content="", name="v.mp4", **extra):
    data = {"content": content, **extra}
    if video is not None:
        data["video"] = (io.BytesIO(video), name)
    return client.post("/api/posts", data=data, content_type="multipart/form-data", headers=_auth_headers(token))


def _send(client, token, to_id, video=None, content="", name="v.mp4", **extra):
    data = {"content": content, **extra}
    if video is not None:
        data["video"] = (io.BytesIO(video), name)
    return client.post(
        f"/api/users/{to_id}/messages", data=data, content_type="multipart/form-data", headers=_auth_headers(token)
    )


class TestPosts:
    def test_it_is_off_by_default_and_stores_nothing(self, client):
        token_a, *_ = _setup(client)

        response = _post(client, token_a, _mp4())

        assert response.status_code == 503
        assert response.get_json()["code"] == "video_disabled"
        assert _stored_files() == []

    def test_text_and_image_posts_keep_working_with_the_switch_off(self, client):
        token_a, *_ = _setup(client)
        response = client.post("/api/posts", json={"content": "hola"}, headers=_auth_headers(token_a))
        assert response.status_code == 201
        assert response.get_json()["post"]["video"] is None

    def test_publishes_a_video_with_no_text(self, client, video_on):
        token_a, *_ = _setup(client)

        response = _post(client, token_a, _mp4(1.0))

        assert response.status_code == 201
        post = response.get_json()["post"]
        assert post["content"] == "" and post["images"] == []
        video = post["video"]
        assert set(video) == {"url", "thumbnail_url", "width", "height", "duration_ms"}
        assert video["url"].endswith(".mp4") and video["thumbnail_url"].endswith(".webp")
        assert (video["width"], video["height"]) == (160, 120)
        assert 950 <= video["duration_ms"] <= 1100
        assert len(_stored_files()) == 2  # video y miniatura

    def test_a_video_post_can_carry_text(self, client, video_on):
        token_a, *_ = _setup(client)
        post = _post(client, token_a, _mp4(), content="mira esto").get_json()["post"]
        assert post["content"] == "mira esto" and post["video"] is not None

    def test_the_duration_comes_from_the_server_not_from_the_client(self, client, video_on):
        token_a, *_ = _setup(client)
        post = _post(client, token_a, _mp4(1.0), duration_ms="999999").get_json()["post"]
        assert post["video"]["duration_ms"] < 1200

    def test_the_stored_file_is_the_normalised_mp4_not_the_original(self, client, video_on):
        token_a, *_ = _setup(client)
        url = _post(client, token_a, make_video(320, 240, 1.0, container="webm", codec="libvpx-vp9", audio=False)
                    ).get_json()["post"]["video"]["url"]

        stored = client.get("/api/media/" + _key(url))

        assert video_info(stored.data)[4] == "h264"

    def test_it_is_served_as_video_mp4_with_range_support(self, client, video_on):
        token_a, *_ = _setup(client)
        video = _post(client, token_a, _mp4()).get_json()["post"]["video"]

        full = client.get("/api/media/" + _key(video["url"]))
        assert full.status_code == 200
        assert full.headers["Content-Type"].startswith("video/mp4")
        assert full.headers["X-Content-Type-Options"] == "nosniff"

        # Los navegadores y la app piden rangos para buscar dentro del video.
        part = client.get("/api/media/" + _key(video["url"]), headers={"Range": "bytes=0-99"})
        assert part.status_code == 206 and len(part.data) == 100

        thumb = client.get("/api/media/" + _key(video["thumbnail_url"]))
        assert thumb.status_code == 200 and thumb.headers["Content-Type"].startswith("image/webp")

    def test_the_feed_and_the_place_lists_show_the_video(self, client, video_on):
        token_a, *_ = _setup(client)
        sent = _post(client, token_a, _mp4()).get_json()["post"]

        feed = client.get("/api/posts", headers=_auth_headers(token_a)).get_json()["posts"]

        assert [p["video"] for p in feed] == [sent["video"]]

    def test_images_and_a_video_cannot_be_mixed(self, client, video_on):
        token_a, *_ = _setup(client)
        png = io.BytesIO()
        Image.new("RGB", (4, 4), (1, 2, 3)).save(png, format="PNG")

        response = client.post(
            "/api/posts",
            data={"content": "", "video": (io.BytesIO(_mp4()), "v.mp4"), "images": (io.BytesIO(png.getvalue()), "f.png")},
            content_type="multipart/form-data",
            headers=_auth_headers(token_a),
        )

        assert response.status_code == 400
        assert _stored_files() == []

    def test_an_invalid_file_is_rejected_and_nothing_is_created(self, client, video_on):
        token_a, *_ = _setup(client)

        response = _post(client, token_a, b"no soy un video" * 50)

        assert response.status_code == 400
        assert _stored_files() == []
        assert client.get("/api/posts", headers=_auth_headers(token_a)).get_json()["posts"] == []

    def test_too_long_is_a_400_with_a_clear_message(self, client, video_on):
        token_a, *_ = _setup(client)
        response = _post(client, token_a, make_video(64, 48, 65.0, fps=2, audio=False))
        assert response.status_code == 400 and "60 segundos" in response.get_json()["msg"]
        assert _stored_files() == []

    def test_too_big_is_a_413(self, client, video_on):
        token_a, *_ = _setup(client)
        response = _post(client, token_a, b"\x00\x00\x00\x18ftypmp42" + b"0" * MAX_VIDEO_UPLOAD_BYTES)
        assert response.status_code == 413
        assert _stored_files() == []

    def test_the_error_never_leaks_decoder_details(self, client, video_on):
        token_a, *_ = _setup(client)
        body = _post(client, token_a, b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 300).get_json()
        text_body = str(body).lower()
        assert "ffmpeg" not in text_body and "invalid argument" not in text_body and "av." not in text_body

    def test_it_requires_a_session(self, client, video_on):
        response = client.post(
            "/api/posts",
            data={"video": (io.BytesIO(_mp4()), "v.mp4")},
            content_type="multipart/form-data",
        )
        assert response.status_code == 401

    def test_deleting_the_post_deletes_both_files_and_the_row(self, client, video_on, app):
        token_a, *_ = _setup(client)
        post = _post(client, token_a, _mp4()).get_json()["post"]
        assert len(_stored_files()) == 2

        response = client.delete(f"/api/posts/{post['id']}", headers=_auth_headers(token_a))

        assert response.status_code == 200
        assert _stored_files() == []
        with app.app_context():
            assert db.session.execute(text("SELECT count(*) FROM video_attachments")).scalar() == 0

    def test_someone_else_cannot_delete_the_post_or_its_files(self, client, video_on):
        token_a, _, token_b, _ = _setup(client)
        post = _post(client, token_a, _mp4()).get_json()["post"]

        response = client.delete(f"/api/posts/{post['id']}", headers=_auth_headers(token_b))

        assert response.status_code == 404
        assert len(_stored_files()) == 2

    def test_a_failure_while_saving_leaves_no_post_and_no_file(self, client, video_on, monkeypatch):
        token_a, *_ = _setup(client)

        def boom(self, *args, **kwargs):
            raise RuntimeError("base caída")

        monkeypatch.setattr(
            "app.infrastructure.persistence.repositories.video_attachment_repository."
            "SQLAlchemyVideoAttachmentRepository.add_for_post",
            boom,
        )

        response = _post(client, token_a, _mp4())

        assert response.status_code == 500
        assert _stored_files() == []
        assert client.get("/api/posts", headers=_auth_headers(token_a)).get_json()["posts"] == []

    def test_editing_a_post_keeps_its_video(self, client, video_on):
        token_a, *_ = _setup(client)
        post = _post(client, token_a, _mp4(), content="antes").get_json()["post"]

        edited = client.patch(
            f"/api/posts/{post['id']}", json={"content": "después"}, headers=_auth_headers(token_a)
        ).get_json()["post"]

        assert edited["content"] == "después" and edited["video"] == post["video"]

    def test_the_rate_limit_counts_every_video_upload(self, client, video_on):
        token_a, *_ = _setup(client)
        statuses = [_post(client, token_a, b"x" * 40).status_code for _ in range(11)]
        # Diez intentos (aunque sean inválidos) y el undécimo ya no pasa: el abuso es el intento.
        assert statuses[:10] == [400] * 10
        assert statuses[10] == 429


class TestMessages:
    def test_it_is_off_by_default(self, client):
        token_a, _, _, id_b = _setup(client)
        response = _send(client, token_a, id_b, _mp4())
        assert response.status_code == 503 and response.get_json()["code"] == "video_disabled"
        assert _stored_files() == []

    def test_sends_a_video_message(self, client, video_on):
        token_a, _, _, id_b = _setup(client)

        response = _send(client, token_a, id_b, _mp4())

        assert response.status_code == 201
        message = response.get_json()["message"]
        assert message["content"] == "" and message["images"] == [] and message["audio"] is None
        assert set(message["video"]) == {"url", "thumbnail_url", "width", "height", "duration_ms"}
        assert len(_stored_files()) == 2

    def test_a_video_cannot_be_mixed_with_a_voice_note_or_images(self, client, video_on):
        token_a, _, _, id_b = _setup(client)
        response = client.post(
            f"/api/users/{id_b}/messages",
            data={"video": (io.BytesIO(_mp4()), "v.mp4"), "audio": (io.BytesIO(b"x" * 50), "a.webm")},
            content_type="multipart/form-data",
            headers=_auth_headers(token_a),
        )
        assert response.status_code == 400
        assert _stored_files() == []

    def test_the_thread_shows_the_video_to_both_people(self, client, video_on):
        token_a, _, token_b, id_b = _setup(client)
        id_a = client.get("/api/users/me", headers=_auth_headers(token_a)).get_json()["user"]["id"]
        sent = _send(client, token_a, id_b, _mp4()).get_json()["message"]

        for token, other in ((token_a, id_b), (token_b, id_a)):
            thread = client.get(f"/api/users/{other}/messages", headers=_auth_headers(token)).get_json()
            assert [m["video"]["url"] for m in thread["messages"]] == [sent["video"]["url"]]

    def test_the_conversation_list_flags_a_video_only_message(self, client, video_on):
        token_a, _, _, id_b = _setup(client)
        _send(client, token_a, id_b, _mp4())

        last = client.get("/api/conversations", headers=_auth_headers(token_a)).get_json()[
            "conversations"
        ][0]["last_message"]

        assert last["has_video"] is True and last["has_audio"] is False and last["has_image"] is False
        assert last["content"] == ""

    def test_a_text_message_has_no_video(self, client, video_on):
        token_a, _, _, id_b = _setup(client)
        message = client.post(
            f"/api/users/{id_b}/messages", json={"content": "hola"}, headers=_auth_headers(token_a)
        ).get_json()["message"]
        assert message["video"] is None

    def test_a_rejected_send_stores_nothing(self, client, video_on):
        token_a, id_a, _, _ = _setup(client)
        assert _send(client, token_a, id_a, _mp4()).status_code == 400  # a uno mismo
        assert _stored_files() == []

    def test_nobody_can_send_to_someone_who_blocked_them(self, client, video_on):
        token_a, id_a, token_b, id_b = _setup(client)
        client.post("/api/users/me/blocks", json={"user_id": id_a}, headers=_auth_headers(token_b))

        assert _send(client, token_a, id_b, _mp4()).status_code == 404
        assert _stored_files() == []

    def test_deleting_the_message_deletes_both_files_and_the_row(self, client, video_on, app):
        token_a, _, _, id_b = _setup(client)
        message = _send(client, token_a, id_b, _mp4()).get_json()["message"]

        response = client.delete(f"/api/messages/{message['id']}", headers=_auth_headers(token_a))

        assert response.status_code == 200
        assert _stored_files() == []
        with app.app_context():
            assert db.session.execute(text("SELECT count(*) FROM video_attachments")).scalar() == 0

    def test_the_recipient_cannot_delete_the_senders_message_or_files(self, client, video_on):
        token_a, _, token_b, id_b = _setup(client)
        message = _send(client, token_a, id_b, _mp4()).get_json()["message"]

        assert client.delete(f"/api/messages/{message['id']}", headers=_auth_headers(token_b)).status_code == 404
        assert len(_stored_files()) == 2

    def test_retrying_with_the_same_client_id_does_not_duplicate_the_video(self, client, video_on):
        token_a, _, _, id_b = _setup(client)

        first = _send(client, token_a, id_b, _mp4(), client_id="video-1")
        second = _send(client, token_a, id_b, _mp4(2.0), client_id="video-1")

        assert (first.status_code, second.status_code) == (201, 200)
        assert first.get_json()["message"]["video"] == second.get_json()["message"]["video"]
        assert len(_stored_files()) == 2

    def test_a_failure_while_saving_leaves_no_message_and_no_file(self, client, video_on, monkeypatch):
        token_a, _, _, id_b = _setup(client)

        def boom(self, *args, **kwargs):
            raise RuntimeError("base caída")

        monkeypatch.setattr(
            "app.infrastructure.persistence.repositories.video_attachment_repository."
            "SQLAlchemyVideoAttachmentRepository.add_for_message",
            boom,
        )

        assert _send(client, token_a, id_b, _mp4()).status_code == 500
        assert _stored_files() == []
        thread = client.get(f"/api/users/{id_b}/messages", headers=_auth_headers(token_a)).get_json()
        assert thread["messages"] == []

    def test_deleting_an_account_returns_both_keys_to_remove(self, client, video_on, app):
        token_a, id_a, _, id_b = _setup(client)
        message = _send(client, token_a, id_b, _mp4()).get_json()["message"]
        expected = {_key(message["video"]["url"]), _key(message["video"]["thumbnail_url"])}

        from app.infrastructure.persistence.repositories.account_deletion_repository import (
            SQLAlchemyAccountDeleter,
        )
        from app.infrastructure.persistence.repositories.rate_limit_repository import (
            SQLAlchemyRateLimitRepository,
        )

        with app.app_context():
            result = SQLAlchemyAccountDeleter(SQLAlchemyRateLimitRepository()).delete_account(id_a)
            assert db.session.execute(text("SELECT count(*) FROM video_attachments")).scalar() == 0
        assert expected <= set(result["media_keys"])


class TestDatabase:
    def test_a_row_must_belong_to_exactly_one_post_or_message(self, app):
        from app.infrastructure.persistence.models import User

        with app.app_context():
            owner = User(name="X", email="x@example.com", password_hash="x", username="xx")
            db.session.add(owner)
            db.session.commit()
            with pytest.raises(Exception):
                db.session.execute(
                    text(
                        "INSERT INTO video_attachments (owner_id, storage_key, thumb_key, width, height, "
                        "duration_ms, size_bytes) VALUES (:o, 'videos/a.mp4', 'videos/a.webp', 2, 2, 1, 1)"
                    ),
                    {"o": str(owner.id)},
                )
                db.session.commit()
            db.session.rollback()
