# Notas de voz en mensajes (ADR-042), contra PostgreSQL real y almacenamiento local temporal
# (ver conftest.py). Los audios se generan con PyAV (tests/audio_fixtures.py): un tono codificado
# como lo grabaría cada navegador.

import io
import os

import av
import pytest
from sqlalchemy import text

from app.domain.media.audio import MAX_VOICE_UPLOAD_BYTES
from app.extensions import db
from app.infrastructure.media.audio_processor import process_voice, sniff_container
from app.domain.media.audio import AudioTooLargeError, AudioTooLongError, InvalidAudioError
from tests.audio_fixtures import make_audio, make_video_with_audio
from tests.test_messages import _auth_headers, _register_and_login

MEDIA_PREFIX = "http://testserver/api/media/"


def _key(url):
    assert url.startswith(MEDIA_PREFIX)
    return url[len(MEDIA_PREFIX):]


def _stored_files():
    files = []
    for folder, _, names in os.walk(os.environ["UPLOAD_DIR"]):
        files += [os.path.join(folder, name) for name in names]
    return files


def _decode_info(data):
    container = av.open(io.BytesIO(data))
    stream = container.streams.audio[0]
    info = (stream.codec_context.name, stream.rate, stream.layout.name, len(container.streams))
    container.close()
    return info


# --- Procesado (sin base de datos) ----------------------------------------------------------------


class TestProcessor:
    @pytest.mark.parametrize(
        "container,codec",
        [("webm", "libopus"), ("ogg", "libopus"), ("mp4", "aac"), ("wav", "pcm_s16le")],
        ids=["chrome-webm-opus", "ogg-opus", "safari-mp4-aac", "wav"],
    )
    def test_every_accepted_format_comes_out_as_mono_aac_in_mp4(self, container, codec):
        data, content_type, duration_ms = process_voice(make_audio(container, codec, seconds=2.0))

        assert content_type == "audio/mp4"
        assert data[4:8] == b"ftyp"
        # Un único flujo de audio, AAC, mono, 24 kHz: lo mismo para todos los orígenes.
        assert _decode_info(data) == ("aac", 24000, "mono", 1)
        assert 1950 <= duration_ms <= 2050

    def test_stereo_is_mixed_down_to_mono(self):
        data, _, _ = process_voice(make_audio("webm", "libopus", seconds=1.0, layout="stereo"))
        assert _decode_info(data)[2] == "mono"

    def test_the_output_is_smaller_than_a_raw_recording(self):
        raw = make_audio("wav", "pcm_s16le", seconds=3.0)
        data, _, _ = process_voice(raw)
        assert len(data) < len(raw) / 5

    def test_containers_are_recognised_by_header_not_by_name(self):
        assert sniff_container(make_audio("webm", "libopus", 0.2)) == "matroska,webm"
        assert sniff_container(make_audio("ogg", "libopus", 0.2)) == "ogg"
        assert sniff_container(make_audio("mp4", "aac", 0.2)) == "mp4"
        assert sniff_container(make_audio("wav", "pcm_s16le", 0.2)) == "wav"
        for junk in (b"", b"hola", b"\x89PNG\r\n\x1a\n" + b"0" * 20, b"%PDF-1.7", b"MZ" + b"0" * 30):
            assert sniff_container(junk) is None

    @pytest.mark.parametrize(
        "junk",
        [b"", b"hola mundo" * 200, b"\x89PNG\r\n\x1a\n" + b"0" * 100, b"%PDF-1.7 " + b"0" * 100],
        ids=["empty", "text", "png", "pdf"],
    )
    def test_anything_that_is_not_audio_is_rejected(self, junk):
        with pytest.raises(InvalidAudioError):
            process_voice(junk)

    def test_a_truncated_recording_is_rejected_not_crashed(self):
        good = make_audio("webm", "libopus", seconds=1.0)
        # Cabecera de contenedor válida pero el resto cortado/corrupto.
        with pytest.raises(InvalidAudioError):
            process_voice(good[:12] + b"\x00" * 200)

    def test_a_video_is_rejected_even_if_it_has_an_audio_track(self):
        with pytest.raises(InvalidAudioError):
            process_voice(make_video_with_audio())

    def test_a_file_over_the_size_limit_is_rejected_before_decoding(self):
        with pytest.raises(AudioTooLargeError):
            process_voice(b"\x1a\x45\xdf\xa3" + b"0" * MAX_VOICE_UPLOAD_BYTES)

    def test_a_recording_over_two_minutes_is_rejected(self):
        # Poca resolución para que generarlo sea rápido: lo que cuenta es la duración.
        raw = make_audio("webm", "libopus", seconds=125.0, rate=16000)
        assert len(raw) < MAX_VOICE_UPLOAD_BYTES
        with pytest.raises(AudioTooLongError):
            process_voice(raw)

    def test_exactly_two_minutes_is_accepted(self):
        _, _, duration_ms = process_voice(make_audio("webm", "libopus", seconds=120.0, rate=16000))
        assert 119_900 <= duration_ms <= 120_500


# --- API -----------------------------------------------------------------------------------------


@pytest.fixture()
def voice_on(app):
    app.config.update(VOICE_MESSAGES_ENABLED=True)


def _setup(client):
    token_a, id_a = _register_and_login(client, username="user_a", email="a@example.com")
    token_b, id_b = _register_and_login(client, username="user_b", email="b@example.com")
    return token_a, id_a, token_b, id_b


def _send(client, token, to_id, audio=None, content="", name="nota.webm", **extra):
    data = {"content": content, **extra}
    if audio is not None:
        data["audio"] = (io.BytesIO(audio), name)
    return client.post(
        f"/api/users/{to_id}/messages",
        data=data,
        content_type="multipart/form-data",
        headers=_auth_headers(token),
    )


def _webm(seconds=2.0):
    return make_audio("webm", "libopus", seconds=seconds)


class TestSendVoiceMessage:
    def test_it_is_off_by_default_and_stores_nothing(self, client):
        token_a, _, _, id_b = _setup(client)

        response = _send(client, token_a, id_b, _webm())

        assert response.status_code == 503
        assert response.get_json()["code"] == "voice_disabled"
        assert _stored_files() == []

    def test_text_messages_keep_working_with_the_switch_off(self, client):
        token_a, _, _, id_b = _setup(client)

        response = client.post(
            f"/api/users/{id_b}/messages", json={"content": "hola"}, headers=_auth_headers(token_a)
        )

        assert response.status_code == 201
        assert response.get_json()["message"]["audio"] is None

    def test_sends_a_voice_note(self, client, voice_on):
        token_a, _, _, id_b = _setup(client)

        response = _send(client, token_a, id_b, _webm(2.0))

        assert response.status_code == 201
        message = response.get_json()["message"]
        assert message["content"] == ""
        assert message["audio"]["url"].endswith(".m4a")
        assert 1950 <= message["audio"]["duration_ms"] <= 2050
        assert os.path.exists(os.path.join(os.environ["UPLOAD_DIR"], _key(message["audio"]["url"])))

    def test_the_response_never_leaks_the_storage_key_or_owner(self, client, voice_on):
        token_a, _, _, id_b = _setup(client)
        audio = _send(client, token_a, id_b, _webm()).get_json()["message"]["audio"]
        assert set(audio) == {"url", "duration_ms"}

    def test_a_voice_note_can_carry_text(self, client, voice_on):
        token_a, _, _, id_b = _setup(client)
        message = _send(client, token_a, id_b, _webm(), content="escucha esto").get_json()["message"]
        assert message["content"] == "escucha esto"
        assert message["audio"] is not None

    def test_the_stored_file_is_the_normalised_aac_not_the_original(self, client, voice_on):
        token_a, _, _, id_b = _setup(client)
        url = _send(client, token_a, id_b, _webm()).get_json()["message"]["audio"]["url"]

        stored = client.get("/api/media/" + _key(url))

        assert _decode_info(stored.data) == ("aac", 24000, "mono", 1)

    def test_the_duration_comes_from_the_server_not_from_the_client(self, client, voice_on):
        token_a, _, _, id_b = _setup(client)

        message = _send(client, token_a, id_b, _webm(2.0), duration_ms="999999").get_json()["message"]

        assert message["audio"]["duration_ms"] < 2100

    def test_it_is_served_publicly_as_audio_mp4_with_range_support(self, client, voice_on):
        token_a, _, _, id_b = _setup(client)
        url = _send(client, token_a, id_b, _webm()).get_json()["message"]["audio"]["url"]

        full = client.get("/api/media/" + _key(url))
        assert full.status_code == 200
        assert full.headers["Content-Type"].startswith("audio/mp4")
        assert full.headers["X-Content-Type-Options"] == "nosniff"

        # Safari no reproduce audio sin peticiones por rangos.
        part = client.get("/api/media/" + _key(url), headers={"Range": "bytes=0-99"})
        assert part.status_code == 206
        assert len(part.data) == 100

    def test_audio_and_images_cannot_be_mixed(self, client, voice_on):
        import struct
        import zlib

        token_a, _, _, id_b = _setup(client)
        # Un PNG mínimo válido (1x1) sin depender de Pillow.
        def chunk(kind, data):
            body = kind + data
            return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))
        png = (
            b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(b"\x00\xff\x00\x00"))
            + chunk(b"IEND", b"")
        )

        response = client.post(
            f"/api/users/{id_b}/messages",
            data={"content": "", "audio": (io.BytesIO(_webm()), "n.webm"), "images": (io.BytesIO(png), "f.png")},
            content_type="multipart/form-data",
            headers=_auth_headers(token_a),
        )

        assert response.status_code == 400
        assert _stored_files() == []

    def test_a_text_message_has_no_audio(self, client, voice_on):
        token_a, _, _, id_b = _setup(client)
        message = client.post(
            f"/api/users/{id_b}/messages", json={"content": "hola"}, headers=_auth_headers(token_a)
        ).get_json()["message"]
        assert message["audio"] is None


class TestRejections:
    def test_an_invalid_file_is_rejected_and_nothing_is_created(self, client, voice_on):
        token_a, _, token_b, id_b = _setup(client)
        _, id_a = None, None  # solo se usa el hilo de A hacia B

        response = _send(client, token_a, id_b, b"no soy un audio" * 50, name="nota.webm")

        assert response.status_code == 400
        assert _stored_files() == []
        thread = client.get(f"/api/users/{id_b}/messages", headers=_auth_headers(token_a)).get_json()
        assert thread["messages"] == []

    def test_a_video_is_rejected(self, client, voice_on):
        token_a, _, _, id_b = _setup(client)
        response = _send(client, token_a, id_b, make_video_with_audio(), name="v.mp4")
        assert response.status_code == 400
        assert _stored_files() == []

    def test_too_long_is_a_400_with_a_clear_message(self, client, voice_on):
        token_a, _, _, id_b = _setup(client)
        response = _send(client, token_a, id_b, make_audio("webm", "libopus", 125.0, rate=16000))
        assert response.status_code == 400
        assert "2 minutos" in response.get_json()["msg"]
        assert _stored_files() == []

    def test_too_big_is_a_413(self, client, voice_on):
        token_a, _, _, id_b = _setup(client)
        response = _send(client, token_a, id_b, b"\x1a\x45\xdf\xa3" + b"0" * MAX_VOICE_UPLOAD_BYTES)
        assert response.status_code == 413
        assert _stored_files() == []

    def test_the_error_never_leaks_decoder_details(self, client, voice_on):
        token_a, _, _, id_b = _setup(client)
        body = _send(client, token_a, id_b, b"\x1a\x45\xdf\xa3" + b"\x00" * 300).get_json()
        text = str(body)
        assert "ffmpeg" not in text.lower() and "av." not in text and "Invalid argument" not in text

    def test_a_rejected_send_stores_nothing(self, client, voice_on):
        token_a, id_a, _, _ = _setup(client)
        # A uno mismo: la comprobación ocurre ANTES de guardar el archivo.
        response = _send(client, token_a, id_a, _webm())
        assert response.status_code == 400
        assert _stored_files() == []

    def test_nobody_can_send_to_someone_who_blocked_them(self, client, voice_on):
        token_a, id_a, token_b, id_b = _setup(client)
        blocked = client.post("/api/users/me/blocks", json={"user_id": id_a}, headers=_auth_headers(token_b))
        assert blocked.status_code == 200

        response = _send(client, token_a, id_b, _webm())

        assert response.status_code == 404
        assert _stored_files() == []

    def test_it_requires_a_session(self, client, voice_on):
        _, _, _, id_b = _setup(client)
        response = client.post(
            f"/api/users/{id_b}/messages",
            data={"audio": (io.BytesIO(_webm()), "n.webm")},
            content_type="multipart/form-data",
        )
        assert response.status_code == 401


class TestThreadsAndLists:
    def test_the_thread_shows_the_voice_note_to_both_people(self, client, voice_on):
        token_a, _, token_b, id_b = _setup(client)
        id_a = client.get("/api/users/me", headers=_auth_headers(token_a)).get_json()["user"]["id"]
        sent = _send(client, token_a, id_b, _webm()).get_json()["message"]

        for token, other in ((token_a, id_b), (token_b, id_a)):
            thread = client.get(f"/api/users/{other}/messages", headers=_auth_headers(token)).get_json()
            assert [m["audio"]["url"] for m in thread["messages"]] == [sent["audio"]["url"]]

    def test_the_conversation_list_flags_a_voice_only_message(self, client, voice_on):
        token_a, _, _, id_b = _setup(client)
        _send(client, token_a, id_b, _webm())

        last = client.get("/api/conversations", headers=_auth_headers(token_a)).get_json()[
            "conversations"
        ][0]["last_message"]

        assert last["has_audio"] is True
        assert last["has_image"] is False
        assert last["content"] == ""

    def test_a_text_message_is_not_flagged_as_audio(self, client, voice_on):
        token_a, _, _, id_b = _setup(client)
        client.post(f"/api/users/{id_b}/messages", json={"content": "hola"}, headers=_auth_headers(token_a))
        last = client.get("/api/conversations", headers=_auth_headers(token_a)).get_json()[
            "conversations"
        ][0]["last_message"]
        assert last["has_audio"] is False


class TestIntegrity:
    def test_deleting_the_message_deletes_the_file_and_the_row(self, client, voice_on, app):
        token_a, _, _, id_b = _setup(client)
        message = _send(client, token_a, id_b, _webm()).get_json()["message"]
        assert len(_stored_files()) == 1

        response = client.delete(f"/api/messages/{message['id']}", headers=_auth_headers(token_a))

        assert response.status_code == 200
        assert _stored_files() == []
        with app.app_context():
            assert db.session.execute(text("SELECT count(*) FROM audio_attachments")).scalar() == 0

    def test_the_recipient_cannot_delete_the_senders_message_or_file(self, client, voice_on):
        token_a, _, token_b, id_b = _setup(client)
        message = _send(client, token_a, id_b, _webm()).get_json()["message"]

        response = client.delete(f"/api/messages/{message['id']}", headers=_auth_headers(token_b))

        assert response.status_code == 404
        assert len(_stored_files()) == 1

    def test_retrying_with_the_same_client_id_does_not_duplicate_the_audio(self, client, voice_on):
        token_a, _, _, id_b = _setup(client)

        first = _send(client, token_a, id_b, _webm(), client_id="voz-1")
        second = _send(client, token_a, id_b, _webm(3.0), client_id="voz-1")

        assert (first.status_code, second.status_code) == (201, 200)
        assert first.get_json()["message"]["id"] == second.get_json()["message"]["id"]
        assert first.get_json()["message"]["audio"] == second.get_json()["message"]["audio"]
        assert len(_stored_files()) == 1

    def test_a_failure_while_saving_leaves_no_message_and_no_file(self, client, voice_on, app, monkeypatch):
        token_a, _, _, id_b = _setup(client)

        def boom(self, *args, **kwargs):
            raise RuntimeError("base caída")

        monkeypatch.setattr(
            "app.infrastructure.persistence.repositories.audio_attachment_repository."
            "SQLAlchemyAudioAttachmentRepository.add_for_message",
            boom,
        )
        response = _send(client, token_a, id_b, _webm())

        assert response.status_code == 500

        assert _stored_files() == []
        thread = client.get(f"/api/users/{id_b}/messages", headers=_auth_headers(token_a)).get_json()
        assert thread["messages"] == []

    def test_editing_a_message_keeps_its_voice_note(self, client, voice_on):
        token_a, _, _, id_b = _setup(client)
        message = _send(client, token_a, id_b, _webm(), content="antes").get_json()["message"]

        edited = client.patch(
            f"/api/messages/{message['id']}", json={"content": "después"}, headers=_auth_headers(token_a)
        ).get_json()["message"]

        assert edited["content"] == "después"
        assert edited["audio"] == message["audio"]

    def test_deleting_an_account_returns_the_audio_keys_to_remove(self, client, voice_on, app):
        token_a, id_a, _, id_b = _setup(client)
        message = _send(client, token_a, id_b, _webm()).get_json()["message"]
        expected = _key(message["audio"]["url"])

        from app.infrastructure.persistence.repositories.account_deletion_repository import (
            SQLAlchemyAccountDeleter,
        )
        from app.infrastructure.persistence.repositories.rate_limit_repository import (
            SQLAlchemyRateLimitRepository,
        )

        with app.app_context():
            result = SQLAlchemyAccountDeleter(SQLAlchemyRateLimitRepository()).delete_account(id_a)
            assert db.session.execute(text("SELECT count(*) FROM audio_attachments")).scalar() == 0

        assert expected in result["media_keys"]

    def test_one_voice_note_per_message_is_enforced_by_the_database(self, client, voice_on, app):
        token_a, id_a, _, id_b = _setup(client)
        message = _send(client, token_a, id_b, _webm()).get_json()["message"]

        from sqlalchemy.exc import IntegrityError

        with app.app_context():
            with pytest.raises(IntegrityError):
                db.session.execute(
                    text(
                        "INSERT INTO audio_attachments (owner_id, message_id, storage_key, duration_ms, size_bytes) "
                        "VALUES (:o, :m, 'voice/otro.m4a', 1000, 10)"
                    ),
                    {"o": id_a, "m": message["id"]},
                )
            db.session.rollback()


class TestAbuse:
    def test_uploads_are_rate_limited(self, client, voice_on):
        token_a, _, _, id_b = _setup(client)
        tiny = make_audio("webm", "libopus", seconds=0.3)

        statuses = [_send(client, token_a, id_b, tiny).status_code for _ in range(31)]

        assert statuses[:30] == [201] * 30
        assert statuses[30] == 429

    def test_text_messages_are_not_counted_against_the_voice_limit(self, client, voice_on):
        token_a, _, _, id_b = _setup(client)
        tiny = make_audio("webm", "libopus", seconds=0.3)
        for _ in range(30):
            assert _send(client, token_a, id_b, tiny).status_code == 201

        response = client.post(
            f"/api/users/{id_b}/messages", json={"content": "sigo pudiendo escribir"}, headers=_auth_headers(token_a)
        )

        assert response.status_code == 201


class TestDataExport:
    def test_the_export_says_a_voice_note_existed_without_including_the_file(self, client, voice_on):
        import json
        import zipfile

        token_a, _, _, id_b = _setup(client)
        _send(client, token_a, id_b, _webm(2.0), content="escucha")
        client.post(f"/api/users/{id_b}/messages", json={"content": "solo texto"}, headers=_auth_headers(token_a))

        created = client.post("/api/data-exports", headers=_auth_headers(token_a)).get_json()["export"]
        download = client.get(f"/api/data-exports/{created['id']}/download", headers=_auth_headers(token_a))
        archive = zipfile.ZipFile(io.BytesIO(download.data))
        messages = json.loads(archive.read("messages.json"))

        by_text = {m["content"]: m for m in messages}
        assert by_text["escucha"]["voice_note_seconds"] in (2, 1)
        assert by_text["solo texto"]["voice_note_seconds"] is None
        assert not any(name.endswith(".m4a") for name in archive.namelist())
