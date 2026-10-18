# Panel de moderación de contenido y apelaciones (ADR-044 §2.5-§2.7). Autorización en el backend,
# contra PostgreSQL real: nada depende de que la interfaz oculte botones.

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.application.content_moderation.process_jobs import process_next
from app.extensions import db
from app.infrastructure.content_moderation.fake_classifiers import FakeImageClassifier
from tests.content_moderation.conftest import (
    attachments,
    make_account,
    make_moderator,
    now,
    publish_post_with_image,
)
from tests.test_messages import _auth_headers


def _set_role(user_id, role):
    db.session.execute(
        text("UPDATE users SET moderation_role = :r, is_moderator = :m WHERE id = :id"),
        {"r": role, "m": role is not None, "id": user_id},
    )
    db.session.commit()


def _staff(client, name, role):
    token, user_id = make_account(client, name)
    _set_role(user_id, role)
    return token, user_id


def _seed(client, repository, settings, name, scores):
    """Una imagen de `name` ya clasificada por el worker con esos puntajes."""
    token, user_id = make_account(client, name)
    publish_post_with_image(client, token)
    process_next(repository, FakeImageClassifier(default_scores=scores), settings, "w", now())
    row = db.session.execute(
        text("SELECT id FROM media_attachments WHERE owner_id = :o"), {"o": user_id}
    ).scalar()
    return token, user_id, str(row)


def _get(client, token, path, **query):
    return client.get(f"/api/{path}", query_string=query, headers=_auth_headers(token))


def _post(client, token, path, body=None):
    return client.post(f"/api/{path}", json=body or {}, headers=_auth_headers(token))


@pytest.fixture()
def world(app, client, moderation_on, repository, settings):
    """Un contenido retenido normal, uno retenido restringido y el personal con cada rol."""
    with app.app_context():
        w = {}
        w["reviewer"], w["reviewer_id"] = _staff(client, "revisora", "reviewer")
        w["child"], w["child_id"] = _staff(client, "infantil", "child_safety")
        w["admin"], w["admin_id"] = _staff(client, "admina", "admin")
        w["regular"], w["regular_id"] = make_account(client, "comun")
        w["a_token"], w["a_id"], w["a_item"] = _seed(
            client, repository, settings, "autora_a", {"violence": 0.6}
        )
        w["b_token"], w["b_id"], w["b_item"] = _seed(
            client, repository, settings, "autora_b", {"child_safety": 0.5}
        )
        yield w


class TestAuthorization:
    def test_everything_is_404_when_the_feature_is_off(self, app, client, repository, settings):
        with app.app_context():
            token, user_id = _staff(client, "revisora", "reviewer")
            for path in ("moderation/media", "moderation/stats", "appeals"):
                assert _get(client, token, path).status_code == 404

    def test_a_regular_account_gets_404_everywhere(self, app, client, world):
        with app.app_context():
            for path in ("moderation/media", "moderation/stats", "moderation/appeals",
                         f"moderation/media/{world['a_item']}", "moderation/audit"):
                assert _get(client, world["regular"], path).status_code == 404
            decision = _post(client, world["regular"], f"moderation/media/{world['a_item']}/decision",
                             {"decision": "approved"})
            assert decision.status_code == 404
            assert attachments()[0]["moderation_status"] == "held"

    def test_anonymous_requests_are_rejected(self, app, client, world):
        assert client.get("/api/moderation/media").status_code == 401
        assert client.get("/api/appeals").status_code == 401

    def test_a_suspended_reviewer_loses_access(self, app, client, world):
        with app.app_context():
            db.session.execute(
                text("UPDATE users SET suspended_at = now() WHERE id = :id"), {"id": world["reviewer_id"]}
            )
            db.session.commit()
            assert _get(client, world["reviewer"], "moderation/media").status_code == 404

    def test_the_role_cannot_be_granted_through_the_api(self, app, client, world):
        with app.app_context():
            client.patch("/api/users/me", json={"moderation_role": "admin", "is_moderator": True},
                         headers=_auth_headers(world["regular"]))
            row = db.session.execute(
                text("SELECT moderation_role, is_moderator FROM users WHERE id = :i"),
                {"i": world["regular_id"]},
            ).one()
            assert tuple(row) == (None, False)

    def test_only_admin_reads_the_audit_and_the_jobs(self, app, client, world):
        with app.app_context():
            for path in ("moderation/audit", "moderation/jobs"):
                assert _get(client, world["reviewer"], path).status_code == 404
                assert _get(client, world["child"], path).status_code == 404
                assert _get(client, world["admin"], path).status_code == 200

    def test_a_legacy_is_moderator_account_works_as_reviewer(self, app, client, world):
        with app.app_context():
            token, user_id = make_account(client, "vieja_mod")
            make_moderator(user_id)
            assert _get(client, token, "moderation/media").status_code == 200
            assert _get(client, token, "moderation/audit").status_code == 404

    def test_2fa_is_enforced_when_required_and_the_role_gets_a_clear_code(
        self, app, client, world
    ):
        with app.app_context():
            app.config["MODERATION_REQUIRE_2FA"] = True
            response = _get(client, world["reviewer"], "moderation/media")
            assert response.status_code == 403
            assert response.get_json()["code"] == "two_factor_required"
            # También en las rutas de reportes que ya existían.
            assert _get(client, world["reviewer"], "moderation/reports").status_code == 403
            # Una cuenta común sigue recibiendo 404, no el aviso.
            assert _get(client, world["regular"], "moderation/media").status_code == 404
            db.session.execute(
                text("UPDATE users SET two_factor_enabled = true WHERE id = :i"),
                {"i": world["reviewer_id"]},
            )
            db.session.commit()
            assert _get(client, world["reviewer"], "moderation/media").status_code == 200

    def test_2fa_is_not_required_by_default(self, app, client, world):
        assert _get(client, world["reviewer"], "moderation/media").status_code == 200


class TestQueueAndDetail:
    def test_a_reviewer_sees_held_items_but_never_the_restricted_one(self, app, client, world):
        with app.app_context():
            ids = [i["id"] for i in _get(client, world["reviewer"], "moderation/media").get_json()["items"]]
            assert ids == [world["a_item"]]

    def test_child_safety_and_admin_see_the_restricted_item_first(self, app, client, world):
        with app.app_context():
            for token in (world["child"], world["admin"]):
                items = _get(client, token, "moderation/media").get_json()["items"]
                assert [i["id"] for i in items] == [world["b_item"], world["a_item"]]  # critical first
                assert items[0]["priority"] == "critical" and items[0]["restricted"] is True

    def test_the_detail_of_a_restricted_item_is_a_404_for_a_reviewer(self, app, client, world):
        with app.app_context():
            assert _get(client, world["reviewer"], f"moderation/media/{world['b_item']}").status_code == 404
            assert _get(client, world["child"], f"moderation/media/{world['b_item']}").status_code == 200

    def test_the_detail_has_results_and_the_audit_trail_without_content(self, app, client, world):
        with app.app_context():
            detail = _get(client, world["reviewer"], f"moderation/media/{world['a_item']}").get_json()
            assert detail["status"] == "held" and detail["reason"] == "doubtful_signal"
            assert detail["results"][0]["scores"] == {"violence": 0.6}
            assert detail["trail"][0]["actor_kind"] == "system"
            assert "storage_key" not in str(detail) and "email" not in str(detail)

    def test_a_reviewer_cannot_preview_or_decide_the_restricted_file(self, app, client, world):
        with app.app_context():
            assert _get(client, world["reviewer"], f"moderation/media/{world['b_item']}/file").status_code == 404
            r = _post(client, world["reviewer"], f"moderation/media/{world['b_item']}/decision",
                      {"decision": "approved"})
            assert r.status_code == 404
            assert db.session.execute(
                text("SELECT moderation_status FROM media_attachments WHERE id = :i"),
                {"i": world["b_item"]},
            ).scalar() == "held"

    def test_moderation_can_preview_a_held_file_while_the_public_cannot(self, app, client, world):
        with app.app_context():
            key = db.session.execute(
                text("SELECT storage_key FROM media_attachments WHERE id = :i"), {"i": world["a_item"]}
            ).scalar()
            assert client.get(f"/api/media/{key}").status_code == 404
            ok = _get(client, world["reviewer"], f"moderation/media/{world['a_item']}/file")
            assert ok.status_code == 200 and ok.headers["Cache-Control"] == "private, no-store"

    def test_pagination_and_bad_parameters(self, app, client, world):
        with app.app_context():
            page = _get(client, world["admin"], "moderation/media", limit=1).get_json()
            assert len(page["items"]) == 1 and page["has_more"] is True
            assert _get(client, world["admin"], "moderation/media", limit=0).status_code == 400
            assert _get(client, world["admin"], "moderation/media", limit="x").status_code == 400
            assert _get(client, world["admin"], "moderation/media", status="nope").status_code == 400


class TestDecisions:
    def test_approving_publishes_it_and_is_audited_as_human(self, app, client, world):
        with app.app_context():
            r = _post(client, world["reviewer"], f"moderation/media/{world['a_item']}/decision",
                      {"decision": "approved", "note": "ok"})
            assert r.status_code == 200 and r.get_json()["to"] == "approved"
            third = _get(client, world["regular"], "posts").get_json()["posts"]
            # Solo la imagen aprobada es visible; la del contenido restringido sigue oculta.
            urls = [i["url"] for post in third for i in post["images"]]
            assert len(urls) == 1 and urls[0]
            trail = _get(client, world["admin"], f"moderation/media/{world['a_item']}").get_json()["trail"]
            assert trail[-1]["actor_kind"] == "human" and trail[-1]["changes"]["note"] == "ok"

    def test_invalid_decisions_are_rejected(self, app, client, world):
        with app.app_context():
            for body in ({"decision": "pending"}, {"decision": "x"}, {}, {"decision": "held", "note": "n" * 501}):
                r = _post(client, world["reviewer"], f"moderation/media/{world['a_item']}/decision", body)
                assert r.status_code == 400

    def test_deciding_on_an_unknown_item_is_404(self, app, client, world):
        with app.app_context():
            r = _post(client, world["reviewer"], f"moderation/media/{uuid.uuid4()}/decision",
                      {"decision": "approved"})
            assert r.status_code == 404


class TestStatsJobsAudit:
    def test_stats_reflect_the_queue_and_hide_restricted_counts_from_reviewers(self, app, client, world):
        with app.app_context():
            admin = _get(client, world["admin"], "moderation/stats").get_json()
            reviewer = _get(client, world["reviewer"], "moderation/stats").get_json()
            assert admin["by_status"]["held"] == 2 and reviewer["by_status"]["held"] == 1
            assert admin["held_by_priority"] == {"critical": 1, "high": 1}
            assert admin["last_7_days"]["auto_held"] == 2
            assert admin["jobs_by_status"]["succeeded"] == 2

    def test_failed_and_dead_jobs_are_listed_and_an_admin_can_retry(self, app, client, world):
        with app.app_context():
            db.session.execute(
                text("UPDATE moderation_jobs SET status = 'dead', attempts = 5, last_error = 'ClassifierError' "
                     "WHERE subject_id = :i"), {"i": world["a_item"]})
            db.session.commit()
            listed = _get(client, world["admin"], "moderation/jobs", status="dead").get_json()["items"]
            assert len(listed) == 1 and listed[0]["last_error"] == "ClassifierError"
            retried = _post(client, world["admin"], f"moderation/jobs/{listed[0]['id']}/retry")
            assert retried.status_code == 200
            row = db.session.execute(
                text("SELECT status, attempts FROM moderation_jobs WHERE id = :i"), {"i": listed[0]["id"]}
            ).one()
            assert tuple(row) == ("queued", 0)
            assert _post(client, world["reviewer"], f"moderation/jobs/{listed[0]['id']}/retry").status_code == 404
            # Un trabajo que no está fallido no se reabre.
            assert _post(client, world["admin"], f"moderation/jobs/{listed[0]['id']}/retry").status_code == 404

    def test_the_audit_lists_automatic_and_human_decisions(self, app, client, world):
        with app.app_context():
            _post(client, world["reviewer"], f"moderation/media/{world['a_item']}/decision",
                  {"decision": "rejected"})
            items = _get(client, world["admin"], "moderation/audit").get_json()["items"]
            kinds = {(i["action"], i["actor_kind"]) for i in items}
            assert ("moderation_auto_decision", "system") in kinds
            assert ("moderation_human_decision", "human") in kinds


class TestAppeals:
    def _appeal(self, client, world, who="a", reason="Es un error"):
        return _post(client, world[f"{who}_token"], "appeals",
                     {"attachment_id": world[f"{who}_item"], "reason": reason})

    def test_the_owner_sees_the_image_id_to_appeal_with(self, app, client, world):
        with app.app_context():
            posts = _get(client, world["a_token"], "posts").get_json()["posts"]
            images = [i for post in posts for i in post["images"]]
            assert len(images) == 1  # la de la otra autora no llega
            assert images[0]["id"] == world["a_item"] and images[0]["moderation_status"] == "held"

    def test_an_owner_can_appeal_a_held_image(self, app, client, world):
        with app.app_context():
            r = self._appeal(client, world)
            assert r.status_code == 201 and r.get_json()["target_hours"] == 72
            mine = _get(client, world["a_token"], "appeals").get_json()["appeals"]
            assert [a["status"] for a in mine] == ["open"]

    def test_someone_elses_content_or_an_unknown_one_is_404(self, app, client, world):
        with app.app_context():
            r = _post(client, world["b_token"], "appeals", {"attachment_id": world["a_item"], "reason": "x"})
            assert r.status_code == 404
            r = _post(client, world["b_token"], "appeals", {"attachment_id": str(uuid.uuid4()), "reason": "x"})
            assert r.status_code == 404

    def test_approved_content_cannot_be_appealed(self, app, client, world):
        with app.app_context():
            _post(client, world["reviewer"], f"moderation/media/{world['a_item']}/decision",
                  {"decision": "approved"})
            assert self._appeal(client, world).status_code == 404

    def test_validation_duplicates_and_the_open_cap(self, app, client, world):
        with app.app_context():
            assert self._appeal(client, world, reason="").status_code == 400
            assert self._appeal(client, world, reason="x" * 501).status_code == 400
            assert _post(client, world["a_token"], "appeals", {"attachment_id": "no", "reason": "x"}).status_code == 400
            assert self._appeal(client, world).status_code == 201
            assert self._appeal(client, world).status_code == 409

    def test_the_moderation_queue_shows_due_dates_and_a_regular_user_cannot_see_it(self, app, client, world):
        with app.app_context():
            self._appeal(client, world)
            listed = _get(client, world["reviewer"], "moderation/appeals").get_json()
            assert listed["target_hours"] == 72 and listed["items"][0]["overdue"] is False
            db.session.execute(text("UPDATE moderation_appeals SET created_at = now() - interval '80 hours'"))
            db.session.commit()
            assert _get(client, world["reviewer"], "moderation/appeals").get_json()["items"][0]["overdue"] is True
            assert _get(client, world["a_token"], "moderation/appeals").status_code == 404

    def test_a_reviewer_cannot_see_or_resolve_a_restricted_appeal(self, app, client, world):
        with app.app_context():
            self._appeal(client, world, who="b")
            assert _get(client, world["reviewer"], "moderation/appeals").get_json()["items"] == []
            appeal_id = db.session.execute(text("SELECT id FROM moderation_appeals")).scalar()
            r = _post(client, world["reviewer"], f"moderation/appeals/{appeal_id}/resolve", {"outcome": "upheld"})
            assert r.status_code == 404
            assert len(_get(client, world["child"], "moderation/appeals").get_json()["items"]) == 1

    def test_overturning_approves_the_image_and_audits_both_steps(self, app, client, world):
        with app.app_context():
            self._appeal(client, world)
            appeal_id = db.session.execute(text("SELECT id FROM moderation_appeals")).scalar()

            r = _post(client, world["reviewer"], f"moderation/appeals/{appeal_id}/resolve",
                      {"outcome": "overturned", "note": "tenían razón"})

            assert r.status_code == 200
            assert attachments()[0]["moderation_status"] == "approved"
            mine = _get(client, world["a_token"], "appeals").get_json()["appeals"][0]
            assert mine["status"] == "overturned" and mine["resolution_note"] == "tenían razón"
            actions = [t["action"] for t in _get(client, world["admin"], f"moderation/media/{world['a_item']}").get_json()["trail"]]
            assert "moderation_appeal_opened" in actions and "moderation_appeal_resolved" in actions

    def test_upholding_keeps_the_image_held(self, app, client, world):
        with app.app_context():
            self._appeal(client, world)
            appeal_id = db.session.execute(text("SELECT id FROM moderation_appeals")).scalar()
            _post(client, world["reviewer"], f"moderation/appeals/{appeal_id}/resolve", {"outcome": "upheld"})
            assert attachments()[0]["moderation_status"] == "held"
            again = _post(client, world["admin"], f"moderation/appeals/{appeal_id}/resolve", {"outcome": "upheld"})
            assert again.status_code == 409

    def test_the_person_who_made_the_original_decision_cannot_review_the_appeal(
        self, app, client, world
    ):
        with app.app_context():
            # El revisor deja el contenido rechazado; la autora apela; el MISMO revisor no puede resolver.
            _post(client, world["reviewer"], f"moderation/media/{world['a_item']}/decision",
                  {"decision": "rejected"})
            self._appeal(client, world)
            appeal_id = db.session.execute(text("SELECT id FROM moderation_appeals")).scalar()

            same = _post(client, world["reviewer"], f"moderation/appeals/{appeal_id}/resolve",
                         {"outcome": "overturned"})
            assert same.status_code == 403
            assert attachments()[0]["moderation_status"] == "rejected"

            other = _post(client, world["admin"], f"moderation/appeals/{appeal_id}/resolve",
                          {"outcome": "overturned"})
            assert other.status_code == 200

    def test_the_database_itself_forbids_self_review(self, app, client, world):
        with app.app_context():
            self._appeal(client, world)
            _post(client, world["reviewer"], f"moderation/media/{world['a_item']}/decision",
                  {"decision": "rejected"})
            with pytest.raises(IntegrityError):
                db.session.execute(text(
                    "UPDATE moderation_appeals SET original_decided_by = CAST(:r AS text), "
                    "reviewer_id = CAST(:r AS uuid), status = 'upheld', resolved_at = now()"),
                    {"r": world["reviewer_id"]})
            db.session.rollback()

    def test_a_moderator_cannot_review_their_own_appeal(self, app, client, world):
        with app.app_context():
            appeal_id = db.session.execute(text(
                "INSERT INTO moderation_appeals (user_id, subject_type, subject_id, reason) "
                "VALUES (:u, 'media_attachment', :s, 'mía') RETURNING id"),
                {"u": world["reviewer_id"], "s": world["a_item"]}).scalar()
            db.session.commit()
            r = _post(client, world["reviewer"], f"moderation/appeals/{appeal_id}/resolve", {"outcome": "upheld"})
            assert r.status_code == 403

    def test_invalid_outcomes_are_rejected(self, app, client, world):
        with app.app_context():
            self._appeal(client, world)
            appeal_id = db.session.execute(text("SELECT id FROM moderation_appeals")).scalar()
            for body in ({}, {"outcome": "approved"}, {"outcome": "upheld", "note": "n" * 501}):
                assert _post(client, world["reviewer"], f"moderation/appeals/{appeal_id}/resolve", body).status_code == 400
