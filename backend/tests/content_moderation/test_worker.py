# Worker de moderación (ADR-044 §2.2-§2.4): trabajos persistentes, idempotencia, reintentos,
# auditoría y la regla de que ningún fallo aprueba. PostgreSQL real.

import threading
from datetime import timedelta

from sqlalchemy import text

from app.application.content_moderation.process_jobs import process_next
from app.domain.content_moderation import jobs
from app.domain.content_moderation.signals import ClassifierError
from app.extensions import db
from app.infrastructure.content_moderation.fake_classifiers import (
    FailingImageClassifier,
    FakeImageClassifier,
)
from tests.content_moderation.conftest import (
    attachments,
    jobs_table,
    make_account,
    now,
    publish_post_with_image,
)


def _run(repository, classifier, settings, at=None):
    return process_next(repository, classifier, settings, "w1", at or now())


def _one_pending_image(client, age_days=400):
    token, user_id = make_account(client, "autora", age_days=age_days)
    publish_post_with_image(client, token)
    return user_id


def _audit_rows():
    return db.session.execute(
        text("SELECT actor_id, actor_kind, action, resource_id, changes FROM admin_audit_log")
    ).mappings().all()


class TestEnqueue:
    def test_the_job_is_created_with_the_image_with_identifiers_only(
        self, app, client, moderation_on
    ):
        with app.app_context():
            _one_pending_image(client)
            [job] = jobs_table()
            [image] = attachments()

            assert (job["kind"], job["subject_type"], job["status"]) == (
                "classify_image", "media_attachment", "queued"
            )
            assert job["subject_id"] == image["id"]
            columns = set(job.keys())
            assert columns.isdisjoint({"content", "payload", "text", "image", "storage_key"})

    def test_enqueuing_the_same_fact_twice_creates_one_job(
        self, app, client, moderation_on, repository
    ):
        with app.app_context():
            _one_pending_image(client)
            [image] = attachments()

            repository.enqueue(jobs.KIND_IMAGE, jobs.SUBJECT_MEDIA_ATTACHMENT, image["id"])
            repository.enqueue(jobs.KIND_IMAGE, jobs.SUBJECT_MEDIA_ATTACHMENT, image["id"])
            repository.commit()

            assert len(jobs_table()) == 1


class TestProcessing:
    def test_a_clean_image_from_an_established_account_is_approved_and_audited(
        self, app, client, moderation_on, repository, settings, classifier
    ):
        with app.app_context():
            _one_pending_image(client, age_days=400)

            assert _run(repository, classifier, settings)[1] == "succeeded"

            [image] = attachments()
            assert image["moderation_status"] == "approved"
            [row] = db.session.execute(text("SELECT * FROM media_attachments")).mappings()
            assert row["moderation_decided_by"] == "auto" and row["moderation_decided_at"]
            [audit] = _audit_rows()
            assert audit["actor_kind"] == "system" and audit["actor_id"] is None
            assert audit["changes"]["from"] == "pending" and audit["changes"]["to"] == "approved"
            assert audit["resource_id"] == image["id"]

    def test_a_doubtful_image_is_held(self, app, client, moderation_on, repository, settings):
        with app.app_context():
            _one_pending_image(client)
            classifier = FakeImageClassifier(default_scores={"violence": 0.6})

            _run(repository, classifier, settings)

            assert attachments()[0]["moderation_status"] == "held"
            result = db.session.execute(text("SELECT * FROM moderation_results")).mappings().one()
            assert (result["decision"], result["priority"]) == ("held", "high")

    def test_a_new_account_with_a_borderline_signal_is_held(
        self, app, client, moderation_on, repository, settings
    ):
        with app.app_context():
            _one_pending_image(client, age_days=2)
            classifier = FakeImageClassifier(default_scores={"sexual": 0.2})

            _run(repository, classifier, settings)

            assert attachments()[0]["moderation_status"] == "held"

    def test_without_a_classifier_everything_is_held_never_approved(
        self, app, client, moderation_on, repository, settings
    ):
        with app.app_context():
            _one_pending_image(client)

            _run(repository, None, settings)

            assert attachments()[0]["moderation_status"] == "held"

    def test_an_unusable_answer_is_held(self, app, client, moderation_on, repository, settings):
        with app.app_context():
            _one_pending_image(client)

            _run(repository, FakeImageClassifier(default_scores=None), settings)

            assert attachments()[0]["moderation_status"] == "held"

    def test_open_reports_against_the_author_hold_a_clean_image(
        self, app, client, moderation_on, repository, settings, classifier
    ):
        with app.app_context():
            user_id = _one_pending_image(client)
            reporter, reporter_id = make_account(client, "reportante")
            db.session.execute(
                text(
                    "INSERT INTO reports (reporter_id, target_type, target_id, reported_user_id, "
                    "reason, status) VALUES (:r, 'user', :u, :u, 'spam', 'open')"
                ),
                {"r": reporter_id, "u": user_id},
            )
            db.session.commit()

            _run(repository, classifier, settings)

            assert attachments()[0]["moderation_status"] == "held"

    def test_the_result_and_the_audit_never_store_the_evaluated_content(
        self, app, client, moderation_on, repository, settings, classifier
    ):
        with app.app_context():
            _one_pending_image(client)
            [image] = attachments()
            _run(repository, classifier, settings)

            result = db.session.execute(text("SELECT * FROM moderation_results")).mappings().one()
            stored = (str(dict(result)) + str(_audit_rows())).lower()
            assert image["storage_key"].lower() not in stored
            assert set(result.keys()) == {
                "id", "job_id", "provider", "model_version", "categories", "scores",
                "decision", "priority", "policy_version", "created_at",
            }

    def test_the_database_forbids_an_automatic_rejection(
        self, app, client, moderation_on, repository, settings, classifier
    ):
        import pytest
        from sqlalchemy.exc import IntegrityError

        with app.app_context():
            _one_pending_image(client)
            _run(repository, classifier, settings)
            with pytest.raises(IntegrityError):
                db.session.execute(text("UPDATE moderation_results SET decision = 'rejected'"))
            db.session.rollback()


class TestIdempotencyAndHumanPrecedence:
    def test_redelivering_a_finished_job_changes_nothing(
        self, app, client, moderation_on, repository, settings, classifier
    ):
        with app.app_context():
            _one_pending_image(client)
            _run(repository, classifier, settings)
            # Se simula una reentrega: el trabajo vuelve a `queued`.
            db.session.execute(text("UPDATE moderation_jobs SET status = 'queued'"))
            db.session.commit()

            _run(repository, classifier, settings)

            assert len(db.session.execute(text("SELECT 1 FROM moderation_results")).all()) == 1
            assert len(_audit_rows()) == 1
            assert attachments()[0]["moderation_status"] == "approved"

    def test_an_automatic_decision_never_overwrites_a_human_one(
        self, app, client, moderation_on, repository, settings, classifier
    ):
        with app.app_context():
            _one_pending_image(client)
            db.session.execute(
                text("UPDATE media_attachments SET moderation_status = 'rejected'")
            )
            db.session.commit()

            _run(repository, classifier, settings)

            assert attachments()[0]["moderation_status"] == "rejected"
            assert _audit_rows() == []

    def test_a_job_for_deleted_content_just_finishes(
        self, app, client, moderation_on, repository, settings, classifier
    ):
        with app.app_context():
            _one_pending_image(client)
            db.session.execute(text("DELETE FROM media_attachments"))
            db.session.commit()

            assert _run(repository, classifier, settings)[1] == "succeeded"
            assert classifier.calls == []


class TestRetriesAndDeadJobs:
    def test_a_failure_is_retried_later_with_backoff_and_never_approves(
        self, app, client, moderation_on, repository, settings
    ):
        with app.app_context():
            _one_pending_image(client)
            t0 = now()

            assert _run(repository, FailingImageClassifier(), settings, t0)[1] == "failed"

            [job] = jobs_table()
            assert job["status"] == "failed" and job["attempts"] == 1
            assert job["last_error"] == "ClassifierError"  # solo la clase, sin texto del proveedor
            assert attachments()[0]["moderation_status"] == "pending"
            # Aún no toca: nada que reclamar antes de la espera.
            assert _run(repository, FailingImageClassifier(), settings, t0) is None
            # Pasada la espera, se reclama de nuevo.
            assert _run(repository, FailingImageClassifier(), settings, t0 + timedelta(seconds=31))

    def test_after_the_last_attempt_the_job_is_dead_and_the_content_stays_pending(
        self, app, client, moderation_on, repository, settings
    ):
        with app.app_context():
            _one_pending_image(client)
            t = now()
            outcomes = []
            for _ in range(settings.max_attempts):
                t += timedelta(hours=2)
                outcomes.append(_run(repository, FailingImageClassifier(), settings, t)[1])

            assert outcomes == ["failed", "failed", "dead"]
            [job] = jobs_table()
            assert job["status"] == "dead" and job["finished_at"] is not None
            assert attachments()[0]["moderation_status"] == "pending"
            # Un trabajo muerto no se vuelve a reclamar.
            assert _run(repository, FakeImageClassifier(), settings, t + timedelta(days=1)) is None

    def test_an_error_inside_the_decision_rolls_back_everything(
        self, app, client, moderation_on, repository, settings
    ):
        class Exploding(FakeImageClassifier):
            def classify(self, storage_key):
                raise RuntimeError("provider said something with private text")

        with app.app_context():
            _one_pending_image(client)

            _run(repository, Exploding(), settings)

            [job] = jobs_table()
            assert job["last_error"] == "RuntimeError"  # nunca el mensaje
            assert attachments()[0]["moderation_status"] == "pending"
            assert _audit_rows() == []

    def test_a_stale_running_job_is_recovered_after_its_lease(
        self, app, client, moderation_on, repository, settings, classifier
    ):
        with app.app_context():
            _one_pending_image(client)
            t0 = now()
            job = repository.claim_next("crashed-worker", t0, settings.lease_seconds)
            assert job is not None
            # Mientras la reserva sigue vigente nadie más lo toma.
            assert repository.claim_next("w2", t0 + timedelta(seconds=10), 300) is None
            # Vencida, otro worker lo recupera.
            assert repository.claim_next("w2", t0 + timedelta(seconds=301), 300)["id"] == job["id"]


class TestConcurrency:
    def test_two_workers_never_claim_the_same_job(self, app, client, moderation_on, repository):
        with app.app_context():
            token, _ = make_account(client, "autora")
            for _ in range(6):
                publish_post_with_image(client, token)
            assert len(jobs_table()) == 6

        claimed, lock = [], threading.Lock()

        def worker(name):
            with app.app_context():
                while True:
                    job = repository.claim_next(name, now(), 300)
                    if job is None:
                        return
                    with lock:
                        claimed.append(str(job["id"]))

        threads = [threading.Thread(target=worker, args=(f"w{i}",)) for i in range(4)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert len(claimed) == 6 and len(set(claimed)) == 6


def test_classifier_error_type_is_a_plain_exception():
    assert issubclass(ClassifierError, Exception)
