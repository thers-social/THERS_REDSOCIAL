# Reels con Mux (ADR-043, ADR-043-A, ADR-044). NINGUNA prueba usa red, cuenta ni credenciales de Mux:
# el cliente es simulado y `requests` se sustituye donde se prueba el adaptador HTTP. PostgreSQL real.

import base64
import json
import time
import uuid

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from sqlalchemy import text

from app.application.content_moderation.process_jobs import process_next
from app.application.videos import video_use_cases as uc
from app.domain.automation import events as signing
from app.domain.videos import rules
from app.extensions import db
from app.infrastructure.persistence.repositories.video_repository import SQLAlchemyVideoRepository
from app.infrastructure.video.mux_client import (
    FakeMuxClient,
    FakePlaybackSigner,
    MuxHttpClient,
    MuxPlaybackSigner,
    build_mux_client,
    build_playback_signer,
)
from tests.content_moderation.conftest import make_account, make_moderator, now
from tests.test_messages import _auth_headers

WEBHOOK_SECRET = "mux-webhook-secret-for-tests"
GOOD_TRACKS = [{"type": "video", "max_width": 1080, "max_height": 1920}]


@pytest.fixture()
def reels(app):
    """Módulo encendido, Mux simulado y la cuenta `autora` en la lista de prueba."""
    app.config.update(VIDEOS_ENABLED=True, VIDEO_UPLOAD_ALLOWLIST="autora",
                      MUX_WEBHOOK_SECRET=WEBHOOK_SECRET)
    mux, signer = FakeMuxClient(), FakePlaybackSigner()
    app.extensions["mux_client"], app.extensions["video_playback_signer"] = mux, signer
    yield mux
    app.config.update(VIDEOS_ENABLED=False, VIDEO_UPLOAD_ALLOWLIST="", MUX_WEBHOOK_SECRET=None)


def _upload(client, token, **body):
    return client.post("/api/videos/uploads", json=body, headers=_auth_headers(token))


def _event(event_type, data, event_id=None):
    return json.dumps({"id": event_id or f"evt_{uuid.uuid4().hex[:10]}", "type": event_type,
                       "data": data}).encode()


def _webhook(client, body, secret=WEBHOOK_SECRET, ts=None):
    header = signing.sign(secret, ts if ts is not None else int(time.time()), body)
    return client.post("/api/webhooks/mux", data=body, headers={"Mux-Signature": header,
                                                                  "Content-Type": "application/json"})


def _ready_data(asset_id, video_id, duration=30.0, policy="signed", playback="pb_" + "x" * 8):
    return {"id": asset_id, "passthrough": str(video_id), "duration": duration,
            "playback_ids": [{"id": playback, "policy": policy}], "tracks": GOOD_TRACKS}


def _video(video_id):
    return db.session.execute(text("SELECT * FROM videos WHERE id = :i"), {"i": str(video_id)}).mappings().one()


def _to_ready(client, video_id, upload_id, asset="asset_1"):
    _webhook(client, _event("video.upload.asset_created", {"id": upload_id, "asset_id": asset}))
    return _webhook(client, _event("video.asset.ready", _ready_data(asset, video_id)))


def _setup_video(client):
    token, owner_id = make_account(client, "autora")
    r = _upload(client, token)
    video = r.get_json()["video"]
    upload_id = db.session.execute(text("SELECT mux_upload_id FROM videos")).scalar()
    return token, owner_id, video["id"], upload_id


def _approve(video_id):
    db.session.execute(text("UPDATE videos SET moderation_status = 'approved' WHERE id = :i"), {"i": str(video_id)})
    db.session.commit()


# ------------------------------------------------------------------------------- flags and D3


class TestFlagAndD3:
    def test_everything_is_404_while_the_module_is_off(self, app, client):
        with app.app_context():
            token, _ = make_account(client, "autora")
            for call in (lambda: _upload(client, token), lambda: client.get("/api/videos", headers=_auth_headers(token)),
                         lambda: client.get("/api/videos"), lambda: client.post("/api/webhooks/mux", data=b"{}")):
                assert call().status_code == 404

    def test_the_webhook_does_not_exist_without_its_secret(self, app, client, reels):
        with app.app_context():
            app.config["MUX_WEBHOOK_SECRET"] = None
            assert _webhook(client, _event("video.asset.ready", {}), secret="anything").status_code == 404

    def test_an_account_outside_the_test_list_cannot_upload_and_mux_is_never_called(
        self, app, client, reels
    ):
        with app.app_context():
            token, _ = make_account(client, "otra")
            r = _upload(client, token)
            assert r.status_code == 404 and reels.uploads == []
            assert db.session.execute(text("SELECT count(*) FROM videos")).scalar() == 0

    def test_an_empty_list_means_nobody(self, app, client, reels):
        with app.app_context():
            app.config["VIDEO_UPLOAD_ALLOWLIST"] = ""
            token, _ = make_account(client, "autora")
            assert _upload(client, token).status_code == 404

    def test_public_upload_is_closed_without_human_review(self, app, client, reels):
        """D3: sin moderación encendida, o con el clasificador simulado, solo vale la lista. Ninguna
        variable de configuración abre la subida por sí sola."""
        with app.app_context():
            app.config.update(
                VIDEO_PUBLIC_UPLOAD=True, PUBLIC_UPLOAD_ALLOWED=True, VIDEOS_PUBLIC=True,
                MODERATION_ENABLED=False, MODERATION_CLASSIFIER="none",
            )
            token, _ = make_account(client, "otra")
            assert _upload(client, token).status_code == 404
            app.config.update(MODERATION_ENABLED=True, MODERATION_CLASSIFIER="fake")
            assert _upload(client, token).status_code == 404

    def test_public_upload_opens_only_when_everything_is_held_for_a_person(self, app, client, reels):
        with app.app_context():
            app.config.update(MODERATION_ENABLED=True, MODERATION_CLASSIFIER="none")
            token, _ = make_account(client, "otra")
            assert _upload(client, token).status_code in (200, 201)
        assert rules.may_upload("otra", frozenset(), human_review_only=True) is True
        assert rules.may_upload("otra", frozenset(), human_review_only=False) is False
        assert rules.may_upload(None, frozenset(), human_review_only=True) is False

    def test_the_list_is_case_insensitive_and_exact(self, app, client, reels):
        assert rules.may_upload("Autora", rules.parse_allowlist(" Autora , otra ")) is True
        assert rules.may_upload("autor", rules.parse_allowlist("autora")) is False
        assert rules.may_upload(None, rules.parse_allowlist("autora")) is False
        assert rules.parse_allowlist(None) == frozenset()


# -------------------------------------------------------------------------------- reservations


class TestUploads:
    def test_a_listed_account_gets_a_direct_upload_and_the_video_is_pending(self, app, client, reels):
        with app.app_context():
            token, _ = make_account(client, "autora")
            r = _upload(client, token, caption="  hola  ")
            video = r.get_json()["video"]
            assert r.status_code == 201 and video["status"] == "uploading" and video["upload_url"]
            row = _video(video["id"])
            assert (row["caption"], row["status"], row["moderation_status"]) == ("hola", "uploading", "pending")
            assert reels.uploads[0]["video_id"] == video["id"]  # el id viaja como passthrough

    def test_the_same_key_never_opens_a_second_upload(self, app, client, reels):
        with app.app_context():
            token, _ = make_account(client, "autora")
            first = _upload(client, token, idempotency_key="abc-123")
            again = client.post("/api/videos/uploads", json={}, headers={**_auth_headers(token), "Idempotency-Key": "abc-123"})
            assert first.status_code == 201 and again.status_code == 200
            assert again.get_json()["video"]["id"] == first.get_json()["video"]["id"]
            assert again.get_json()["video"]["upload_url"] is None
            assert len(reels.uploads) == 1
            assert db.session.execute(text("SELECT count(*) FROM videos")).scalar() == 1

    @pytest.mark.parametrize("body", [{"idempotency_key": "has space"}, {"idempotency_key": "x" * 81},
                                       {"caption": "c" * 201}, {"caption": 5}])
    def test_invalid_input_is_a_400_and_creates_nothing(self, app, client, reels, body):
        with app.app_context():
            token, _ = make_account(client, "autora")
            assert _upload(client, token, **body).status_code == 400
            assert db.session.execute(text("SELECT count(*) FROM videos")).scalar() == 0

    def test_without_a_configured_provider_it_is_a_503_and_nothing_is_invented(self, app, client, reels):
        with app.app_context():
            app.extensions["mux_client"] = None
            token, _ = make_account(client, "autora")
            assert _upload(client, token).status_code == 503
            assert db.session.execute(text("SELECT count(*) FROM videos")).scalar() == 0

    def test_a_provider_failure_marks_the_reservation_failed_without_leaking_detail(self, app, client, reels):
        with app.app_context():
            reels.fail_with = rules.ProviderUnavailableError("secret detail")
            token, _ = make_account(client, "autora")
            r = _upload(client, token)
            assert r.status_code == 503 and "secret" not in r.get_data(as_text=True)
            row = db.session.execute(text("SELECT status, failure_reason FROM videos")).one()
            assert tuple(row) == ("failed", "provider_unavailable")

    def test_ten_reservations_a_day_per_account(self, app, client, reels):
        with app.app_context():
            token, _ = make_account(client, "autora")
            codes = [_upload(client, token).status_code for _ in range(11)]
            assert codes.count(201) == 10 and codes[-1] == 429

    def test_anonymous_requests_are_rejected(self, app, client, reels):
        assert client.post("/api/videos/uploads", json={}).status_code == 401


# ------------------------------------------------------------------------------ webhook security


class TestWebhookSecurity:
    def _body(self):
        return _event("video.asset.ready", _ready_data("a1", uuid.uuid4()))

    def test_bad_missing_old_and_foreign_signatures_are_400_and_change_nothing(self, app, client, reels):
        with app.app_context():
            body = self._body()
            assert _webhook(client, body, secret="wrong").status_code == 400
            assert _webhook(client, body, ts=int(time.time()) - 3600).status_code == 400
            assert client.post("/api/webhooks/mux", data=body).status_code == 400
            assert client.post("/api/webhooks/mux", data=body, headers={"Mux-Signature": "garbage"}).status_code == 400
            header = signing.sign(WEBHOOK_SECRET, int(time.time()), b"another body")
            assert client.post("/api/webhooks/mux", data=body, headers={"Mux-Signature": header}).status_code == 400
            assert db.session.execute(text("SELECT count(*) FROM mux_webhook_events")).scalar() == 0

    @pytest.mark.parametrize("raw", [b"not json", b"[]", b'{"type":"x"}', b'{"id":5,"type":"x"}',
                                      b'{"id":"e","type":"x","data":[]}'])
    def test_signed_but_malformed_bodies_are_400(self, app, client, reels, raw):
        with app.app_context():
            assert _webhook(client, raw).status_code == 400

    def test_the_failure_reason_is_not_explained(self, app, client, reels):
        with app.app_context():
            r = _webhook(client, self._body(), secret="wrong")
            assert r.get_json() == {"msg": "Solicitud inválida"}

    def test_unknown_event_types_are_accepted_and_ignored(self, app, client, reels):
        with app.app_context():
            r = _webhook(client, _event("video.something.new", {"id": "x"}))
            assert r.status_code == 200 and r.get_json()["result"] == "ignored"


# ------------------------------------------------------------------------------ webhook lifecycle


class TestWebhookLifecycle:
    def test_upload_to_ready_and_the_video_stays_hidden_until_approved(self, app, client, reels):
        with app.app_context():
            token, _, video_id, upload_id = _setup_video(client)

            assert _webhook(client, _event("video.upload.asset_created", {"id": upload_id, "asset_id": "a1"})).status_code == 200
            assert _video(video_id)["status"] == "processing"
            assert _webhook(client, _event("video.asset.ready", _ready_data("a1", video_id))).status_code == 200

            row = _video(video_id)
            assert (row["status"], row["mux_playback_id"], row["duration_ms"], row["width"], row["height"]) == (
                "ready", "pb_xxxxxxxx", 30000, 1080, 1920)
            assert row["moderation_status"] == "pending"
            job = db.session.execute(text("SELECT subject_type, kind, status FROM moderation_jobs")).one()
            assert tuple(job) == ("video", "classify_image", "queued")

    def test_a_repeated_event_changes_nothing(self, app, client, reels):
        with app.app_context():
            _, _, video_id, upload_id = _setup_video(client)
            body = _event("video.upload.asset_created", {"id": upload_id, "asset_id": "a1"}, event_id="evt_same")
            first, second = _webhook(client, body), _webhook(client, body)
            assert first.get_json()["duplicate"] is False and second.get_json() == {"duplicate": True}
            assert db.session.execute(text("SELECT count(*) FROM mux_webhook_events")).scalar() == 1

    def test_ready_before_asset_created_still_ends_ready_and_a_late_event_does_not_regress_it(
        self, app, client, reels
    ):
        with app.app_context():
            _, _, video_id, upload_id = _setup_video(client)
            _webhook(client, _event("video.asset.ready", _ready_data("a1", video_id)))
            assert _video(video_id)["status"] == "ready"
            _webhook(client, _event("video.upload.asset_created", {"id": upload_id, "asset_id": "a1"}))
            assert _video(video_id)["status"] == "ready"
            assert db.session.execute(text("SELECT count(*) FROM moderation_jobs")).scalar() == 1

    def test_an_event_that_arrives_before_the_video_is_deferred_and_resolved_later(self, app, client, reels):
        with app.app_context():
            future_id = uuid.uuid4()
            r = _webhook(client, _event("video.asset.ready", _ready_data("a9", future_id)))
            assert r.get_json()["result"] == "deferred"
            token, owner_id = make_account(client, "autora")
            db.session.execute(text("INSERT INTO videos (id, owner_id, status) VALUES (:i, :o, 'uploading')"),
                               {"i": str(future_id), "o": owner_id})
            db.session.commit()

            resolved = uc.reprocess_deferred(SQLAlchemyVideoRepository())

            assert resolved == 1 and _video(future_id)["status"] == "ready"
            assert db.session.execute(text("SELECT status FROM mux_webhook_events")).scalar() == "processed"

    def test_more_than_sixty_seconds_is_blocked_and_the_asset_is_queued_for_deletion(self, app, client, reels):
        with app.app_context():
            _, _, video_id, upload_id = _setup_video(client)
            _webhook(client, _event("video.asset.ready", _ready_data("a1", video_id, duration=60.5)))
            row = _video(video_id)
            assert (row["status"], row["failure_reason"], row["mux_playback_id"]) == ("blocked", "duration_exceeded", None)
            assert db.session.execute(text("SELECT external_id FROM pending_external_deletions")).scalar() == "a1"
            assert db.session.execute(text("SELECT count(*) FROM moderation_jobs")).scalar() == 0

    def test_exactly_sixty_seconds_is_allowed(self, app, client, reels):
        with app.app_context():
            _, _, video_id, _ = _setup_video(client)
            _webhook(client, _event("video.asset.ready", _ready_data("a1", video_id, duration=60.0)))
            assert _video(video_id)["status"] == "ready"

    @pytest.mark.parametrize("duration", [None, "abc", -1, float("inf")])
    def test_a_missing_or_nonsense_duration_never_becomes_ready(self, app, client, reels, duration):
        with app.app_context():
            _, _, video_id, _ = _setup_video(client)
            data = _ready_data("a1", video_id)
            data["duration"] = duration
            _webhook(client, _event("video.asset.ready", data))
            assert _video(video_id)["status"] != "ready"

    def test_a_public_playback_policy_is_never_published(self, app, client, reels):
        with app.app_context():
            _, _, video_id, _ = _setup_video(client)
            _webhook(client, _event("video.asset.ready", _ready_data("a1", video_id, policy="public")))
            row = _video(video_id)
            assert (row["status"], row["failure_reason"]) == ("blocked", "no_signed_playback")

    def test_asset_errors_fail_the_video_and_queue_the_deletion(self, app, client, reels):
        with app.app_context():
            _, _, video_id, upload_id = _setup_video(client)
            _webhook(client, _event("video.upload.asset_created", {"id": upload_id, "asset_id": "a1"}))
            _webhook(client, _event("video.asset.errored", {"id": "a1", "passthrough": video_id}))
            assert _video(video_id)["status"] == "failed"
            assert db.session.execute(text("SELECT count(*) FROM pending_external_deletions")).scalar() == 1

    def test_an_upload_error_fails_the_video(self, app, client, reels):
        with app.app_context():
            _, _, video_id, upload_id = _setup_video(client)
            _webhook(client, _event("video.upload.errored", {"id": upload_id}))
            assert _video(video_id)["failure_reason"] == "upload_failed"

    def test_a_terminal_video_is_never_pulled_back(self, app, client, reels):
        with app.app_context():
            _, _, video_id, upload_id = _setup_video(client)
            _to_ready(client, video_id, upload_id)
            _webhook(client, _event("video.asset.errored", {"id": "asset_1", "passthrough": video_id}))
            _webhook(client, _event("video.upload.errored", {"id": upload_id}))
            assert _video(video_id)["status"] == "ready"


# -------------------------------------------------------------------------------- visibility


def _ready_row(owner_id, status="ready", moderation="approved", playback="pb_1"):
    return db.session.execute(text(
        "INSERT INTO videos (owner_id, status, moderation_status, mux_playback_id, mux_asset_id, duration_ms, ready_at) "
        "VALUES (:o, :s, :m, :p, :a, 1000, now()) RETURNING id"),
        {"o": owner_id, "s": status, "m": moderation, "p": playback, "a": f"a_{uuid.uuid4().hex[:8]}"}).scalar()


def _follow(client, token, target_id):
    client.post(f"/api/users/{target_id}/follow", headers=_auth_headers(token))


class TestVisibility:
    def test_a_pending_or_unready_video_is_invisible_to_everyone_but_its_owner(self, app, client, reels):
        with app.app_context():
            owner, owner_id = make_account(client, "autora")
            other, _ = make_account(client, "lectora")
            hidden = [_ready_row(owner_id, moderation="pending"), _ready_row(owner_id, moderation="held"),
                      _ready_row(owner_id, moderation="rejected"), _ready_row(owner_id, status="processing"),
                      _ready_row(owner_id, status="blocked")]
            db.session.commit()
            for vid in hidden:
                assert client.get(f"/api/videos/{vid}", headers=_auth_headers(other)).status_code == 404
            assert client.get("/api/videos", headers=_auth_headers(other)).get_json()["videos"] == []
            assert client.get(f"/api/videos/{hidden[0]}", headers=_auth_headers(owner)).status_code == 200

    def test_the_owner_sees_status_but_never_playback_before_approval(self, app, client, reels):
        with app.app_context():
            owner, owner_id = make_account(client, "autora")
            vid = _ready_row(owner_id, moderation="pending")
            db.session.commit()
            video = client.get(f"/api/videos/{vid}", headers=_auth_headers(owner)).get_json()["video"]
            assert video["status"] == "ready" and video["moderation_status"] == "pending"
            assert video["playback"] is None

    def test_an_approved_ready_video_gets_a_short_signed_token_per_viewer(self, app, client, reels):
        with app.app_context():
            _, owner_id = make_account(client, "autora")
            viewer, _ = make_account(client, "lectora")
            vid = _ready_row(owner_id, playback="pbabc123")
            db.session.commit()
            video = client.get(f"/api/videos/{vid}", headers=_auth_headers(viewer)).get_json()["video"]
            url = video["playback"]["hls_url"]
            assert url.startswith("https://stream.mux.com/pbabc123.m3u8?token=")
            claims = jwt.decode(url.split("token=")[1], FakePlaybackSigner.SECRET, algorithms=["HS256"], audience="v")
            assert claims["sub"] == "pbabc123" and 3500 < claims["exp"] - time.time() <= 3600
            assert "status" not in video and "moderation_status" not in video  # solo para su dueño

    def test_responses_never_expose_mux_identifiers(self, app, client, reels):
        with app.app_context():
            owner, owner_id = make_account(client, "autora")
            viewer, _ = make_account(client, "lectora")
            vid = _ready_row(owner_id)
            db.session.commit()
            ids = db.session.execute(text("SELECT mux_asset_id FROM videos")).scalar()
            for token in (owner, viewer):
                body = client.get(f"/api/videos/{vid}", headers=_auth_headers(token)).get_data(as_text=True)
                listed = client.get("/api/videos", headers=_auth_headers(token)).get_data(as_text=True)
                assert ids not in body + listed and "mux_" not in body + listed

    def test_private_accounts_blocks_and_suspensions_are_respected(self, app, client, reels):
        with app.app_context():
            owner, owner_id = make_account(client, "autora")
            follower, follower_id = make_account(client, "seguidora")
            stranger, stranger_id = make_account(client, "extrana")
            vid = _ready_row(owner_id)
            db.session.commit()
            get = lambda tok: client.get(f"/api/videos/{vid}", headers=_auth_headers(tok)).status_code

            db.session.execute(text("UPDATE users SET is_private = true WHERE id = :i"), {"i": owner_id})
            db.session.commit()
            _follow(client, follower, owner_id)
            db.session.execute(text("UPDATE follows SET status = 'accepted' WHERE follower_id = :f"), {"f": follower_id})
            db.session.commit()
            assert (get(stranger), get(follower)) == (404, 200)

            db.session.execute(text("UPDATE users SET is_private = false WHERE id = :i"), {"i": owner_id})
            db.session.execute(text("INSERT INTO user_restrictions (owner_id, target_id, kind) VALUES (:o, :t, 'block')"),
                               {"o": stranger_id, "t": owner_id})
            db.session.commit()
            assert (get(stranger), get(follower)) == (404, 200)

            db.session.execute(text("UPDATE users SET suspended_at = now() WHERE id = :i"), {"i": owner_id})
            db.session.commit()
            assert get(follower) == 404

    def test_the_feed_paginates_filters_by_author_and_validates_input(self, app, client, reels):
        with app.app_context():
            _, a_id = make_account(client, "autora")
            _, b_id = make_account(client, "otra")
            viewer, _ = make_account(client, "lectora")
            for owner in (a_id, a_id, b_id):
                _ready_row(owner)
            db.session.commit()
            h = _auth_headers(viewer)
            assert len(client.get("/api/videos", headers=h).get_json()["videos"]) == 3
            page = client.get("/api/videos?limit=2", headers=h).get_json()
            assert len(page["videos"]) == 2 and page["has_more"] is True
            assert len(client.get(f"/api/videos?author={a_id}", headers=h).get_json()["videos"]) == 2
            for bad in ("limit=0", "limit=31", "limit=x", "offset=-1", "author=nope"):
                assert client.get(f"/api/videos?{bad}", headers=h).status_code == 400

    def test_mine_lists_every_state(self, app, client, reels):
        with app.app_context():
            owner, owner_id = make_account(client, "autora")
            _ready_row(owner_id, moderation="pending")
            _ready_row(owner_id, status="failed", moderation="pending")
            db.session.commit()
            assert len(client.get("/api/videos/mine", headers=_auth_headers(owner)).get_json()["videos"]) == 2


# ------------------------------------------------------------------------------------- deletion


class TestDeletion:
    def test_the_owner_deletes_the_row_and_the_mux_asset_is_queued(self, app, client, reels):
        with app.app_context():
            owner, owner_id = make_account(client, "autora")
            vid = _ready_row(owner_id)
            db.session.commit()
            assert client.delete(f"/api/videos/{vid}", headers=_auth_headers(owner)).status_code == 200
            assert db.session.execute(text("SELECT count(*) FROM videos")).scalar() == 0
            assert db.session.execute(text("SELECT provider FROM pending_external_deletions")).scalar() == "mux"

    def test_someone_else_cannot_delete_it(self, app, client, reels):
        with app.app_context():
            _, owner_id = make_account(client, "autora")
            other, _ = make_account(client, "otra")
            vid = _ready_row(owner_id)
            db.session.commit()
            assert client.delete(f"/api/videos/{vid}", headers=_auth_headers(other)).status_code == 404
            assert db.session.execute(text("SELECT count(*) FROM videos")).scalar() == 1

    def test_the_sweep_deletes_in_mux_and_retries_failures_until_dead(self, app, client, reels):
        with app.app_context():
            repo = SQLAlchemyVideoRepository()
            repo.enqueue_external_deletion("mux", "asset_ok")
            repo.commit()
            assert uc.sweep_external_deletions(repo, reels, now())["done"] == 1 and reels.deleted == ["asset_ok"]

            repo.enqueue_external_deletion("mux", "asset_bad")
            repo.commit()
            reels.fail_with = rules.ProviderUnavailableError("down")
            from datetime import timedelta
            t, outcomes = now(), []
            for _ in range(9):
                t += timedelta(hours=3)
                outcomes.append(uc.sweep_external_deletions(repo, reels, t))
            assert sum(o["dead"] for o in outcomes) == 1
            assert db.session.execute(text("SELECT status FROM pending_external_deletions WHERE external_id='asset_bad'")).scalar() == "dead"

    def test_without_a_provider_the_deletions_wait(self, app, client, reels):
        with app.app_context():
            repo = SQLAlchemyVideoRepository()
            repo.enqueue_external_deletion("mux", "asset_x")
            repo.commit()
            assert uc.sweep_external_deletions(repo, None, now()) == {"done": 0, "failed": 0, "dead": 0}
            assert db.session.execute(text("SELECT status FROM pending_external_deletions")).scalar() == "queued"

    def test_deleting_the_account_queues_the_mux_assets_before_the_rows_cascade(self, app, client, reels):
        from app.infrastructure.persistence.repositories.account_deletion_repository import SQLAlchemyAccountDeleter
        from app.infrastructure.persistence.repositories.rate_limit_repository import SQLAlchemyRateLimitRepository

        with app.app_context():
            _, owner_id = make_account(client, "autora")
            _ready_row(owner_id)
            db.session.commit()
            asset = db.session.execute(text("SELECT mux_asset_id FROM videos")).scalar()

            SQLAlchemyAccountDeleter(SQLAlchemyRateLimitRepository()).delete_account(owner_id)

            assert db.session.execute(text("SELECT count(*) FROM videos")).scalar() == 0
            assert db.session.execute(text("SELECT external_id FROM pending_external_deletions")).scalar() == asset


# ------------------------------------------------------------------------------- moderation


class TestModerationOfVideos:
    @pytest.fixture()
    def staff(self, app, client, moderation_on):
        with app.app_context():
            token, user_id = make_account(client, "revisora")
            db.session.execute(text("UPDATE users SET is_moderator = true, moderation_role = 'reviewer' WHERE id = :i"), {"i": user_id})
            db.session.commit()
            yield token

    def test_without_a_classifier_a_ready_video_is_held_for_a_person_never_approved(
        self, app, client, reels, staff, repository, settings
    ):
        with app.app_context():
            _, _, video_id, upload_id = _setup_video(client)
            _to_ready(client, video_id, upload_id)

            process_next(repository, None, settings, "w", now())

            assert _video(video_id)["moderation_status"] == "held"
            audit = db.session.execute(text("SELECT resource_type, actor_kind FROM admin_audit_log")).one()
            assert tuple(audit) == ("video", "system")

    def test_the_panel_lists_videos_and_gives_moderators_a_signed_hls_preview(
        self, app, client, reels, staff, repository, settings
    ):
        with app.app_context():
            _, _, video_id, upload_id = _setup_video(client)
            _to_ready(client, video_id, upload_id)
            process_next(repository, None, settings, "w", now())
            h = _auth_headers(staff)

            queue = client.get("/api/moderation/media?type=video", headers=h).get_json()
            assert [i["parent_type"] for i in queue["items"]] == ["reel"] and queue["items"][0]["type"] == "video"
            preview = client.get(f"/api/moderation/media/{video_id}/preview-url?type=video", headers=h).get_json()
            assert preview["kind"] == "hls" and "stream.mux.com/pb_xxxxxxxx.m3u8?token=" in preview["url"]
            assert preview["expires_in"] == 300
            assert client.get(f"/api/moderation/media/{video_id}/file?type=video", headers=h).status_code == 409

    def test_a_regular_account_gets_no_preview(self, app, client, reels, staff, repository, settings):
        with app.app_context():
            owner, _, video_id, upload_id = _setup_video(client)
            _to_ready(client, video_id, upload_id)
            r = client.get(f"/api/moderation/media/{video_id}/preview-url?type=video", headers=_auth_headers(owner))
            assert r.status_code == 404

    def test_approval_by_a_person_publishes_it(self, app, client, reels, staff, repository, settings):
        with app.app_context():
            _, _, video_id, upload_id = _setup_video(client)
            _to_ready(client, video_id, upload_id)
            viewer, _ = make_account(client, "lectora")
            assert client.get(f"/api/videos/{video_id}", headers=_auth_headers(viewer)).status_code == 404

            r = client.post(f"/api/moderation/media/{video_id}/decision?type=video",
                            json={"decision": "approved"}, headers=_auth_headers(staff))

            assert r.status_code == 200
            assert client.get(f"/api/videos/{video_id}", headers=_auth_headers(viewer)).get_json()["video"]["playback"]

    def test_an_appeal_for_a_video_is_possible(self, app, client, reels, staff, repository, settings):
        with app.app_context():
            owner, _, video_id, upload_id = _setup_video(client)
            _to_ready(client, video_id, upload_id)
            process_next(repository, None, settings, "w", now())
            r = client.post("/api/appeals", json={"attachment_id": video_id, "type": "video", "reason": "error"},
                            headers=_auth_headers(owner))
            assert r.status_code == 201

    def test_moderation_does_not_need_the_flag_for_videos_to_stay_hidden(self, app, client, reels):
        """Sin MODERATION_ENABLED nadie aprueba: el video se queda `pending` y oculto (falla cerrado)."""
        with app.app_context():
            _, _, video_id, upload_id = _setup_video(client)
            _to_ready(client, video_id, upload_id)
            viewer, _ = make_account(client, "lectora")
            assert client.get(f"/api/videos/{video_id}", headers=_auth_headers(viewer)).status_code == 404


# ----------------------------------------------------------------------------- the adapters


class TestAdapters:
    def test_the_playback_token_is_a_valid_rs256_jwt_for_the_right_playback_id(self):
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                serialization.NoEncryption())
        signer = MuxPlaybackSigner("kid-1", base64.b64encode(pem).decode())
        token = signer.sign("pb_abc", 600)
        header = jwt.get_unverified_header(token)
        claims = jwt.decode(token, key.public_key(), algorithms=["RS256"], audience="v")
        assert header["kid"] == "kid-1" and claims["sub"] == "pb_abc" and claims["kid"] == "kid-1"
        assert 590 < claims["exp"] - time.time() <= 600

    def test_the_http_client_asks_for_signed_playback_and_never_leaks_errors(self, monkeypatch):
        seen = {}

        class Resp:
            status_code = 201
            text = "secret body"

            def json(self):
                return {"data": {"id": "up_1", "url": "https://storage.example/up"}}

        def fake_request(method, url, **kwargs):
            seen.update(method=method, url=url, **kwargs)
            return Resp()

        monkeypatch.setattr("requests.request", fake_request)
        out = MuxHttpClient("id", "secret").create_direct_upload("vid-1", "https://app.example")
        body = seen["json"]
        assert out == {"upload_id": "up_1", "url": "https://storage.example/up"}
        assert body["new_asset_settings"]["playback_policy"] == ["signed"]
        assert body["new_asset_settings"]["passthrough"] == "vid-1"
        assert seen["auth"] == ("id", "secret") and seen["allow_redirects"] is False
        assert seen["url"] == "https://api.mux.com/video/v1/uploads"

    @pytest.mark.parametrize("status", [400, 401, 429, 500])
    def test_http_errors_become_a_provider_error_without_body_or_credentials(self, monkeypatch, status):
        class Resp:
            status_code = status
            text = "token-secret in body"

        monkeypatch.setattr("requests.request", lambda *a, **k: Resp())
        with pytest.raises(rules.ProviderUnavailableError) as caught:
            MuxHttpClient("id", "token-secret").create_direct_upload("v", None)
        assert "secret" not in str(caught.value)

    def test_network_errors_keep_only_the_class(self, monkeypatch):
        import requests

        def boom(*a, **k):
            raise requests.ConnectionError("https://api.mux.com secret")

        monkeypatch.setattr("requests.request", boom)
        with pytest.raises(rules.ProviderUnavailableError) as caught:
            MuxHttpClient("id", "s").delete_asset("a")
        assert str(caught.value) == "ConnectionError"

    def test_deleting_an_asset_that_no_longer_exists_counts_as_deleted(self, monkeypatch):
        class Resp:
            status_code = 404

        monkeypatch.setattr("requests.request", lambda *a, **k: Resp())
        MuxHttpClient("id", "s").delete_asset("gone")

    def test_clients_are_only_built_from_real_credentials_or_an_explicit_fake(self):
        assert build_mux_client({}) is None and build_playback_signer({}) is None
        assert build_mux_client({"MUX_CLIENT": "none"}) is None
        assert isinstance(build_mux_client({"MUX_CLIENT": "fake"}), FakeMuxClient)
        assert isinstance(build_mux_client({"MUX_TOKEN_ID": "i", "MUX_TOKEN_SECRET": "s"}), MuxHttpClient)
        assert build_mux_client({"MUX_TOKEN_ID": "i"}) is None
        assert isinstance(build_playback_signer({"MUX_CLIENT": "fake"}), FakePlaybackSigner)

    def test_the_state_machine_only_moves_forward(self):
        assert rules.can_transition("pending", "uploading") and rules.can_transition("processing", "ready")
        for terminal in ("failed", "blocked"):
            assert not any(rules.can_transition(terminal, s) for s in rules.ALL_STATUSES)
        assert not rules.can_transition("ready", "processing") and not rules.can_transition("ready", "failed")
        assert rules.can_transition("ready", "blocked")
