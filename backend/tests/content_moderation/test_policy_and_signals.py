# Moderación de contenido (ADR-044): piezas puras. Motor de políticas, señales y reintentos.
# Sin base de datos ni red.

import itertools

import pytest

from app.domain.content_moderation import jobs, policy, status
from app.domain.content_moderation.signals import CATEGORIES, Signal

OLD = 400.0  # días de antigüedad: una cuenta con historial
NEW = 1.0


def _signal(**scores):
    return Signal(scores, "fake", "fake-1")


class TestSignal:
    def test_scores_are_kept_when_valid(self):
        signal = _signal(sexual=0.2, violence=0.0)
        assert signal.usable and signal.top_score == 0.2

    @pytest.mark.parametrize(
        "bad",
        [{"unknown_category": 0.5}, {"sexual": 1.5}, {"sexual": -0.1}, {"sexual": "high"},
         {"sexual": True}, {"sexual": None}],
    )
    def test_anything_outside_the_schema_invalidates_the_whole_signal(self, bad):
        signal = Signal(bad, "fake", "fake-1")
        assert signal.usable is False and signal.scores == {}

    def test_an_unclassified_signal_is_not_usable(self):
        assert Signal.unclassified("fake", "v").usable is False


class TestPolicyEngine:
    def test_a_clean_signal_from_an_established_account_is_approved(self):
        decision = policy.decide(_signal(sexual=0.01), OLD, 0)
        assert decision.status == status.APPROVED

    def test_a_doubtful_signal_is_held(self):
        decision = policy.decide(_signal(violence=0.5), OLD, 0)
        assert (decision.status, decision.priority) == (status.HELD, policy.PRIORITY_HIGH)

    def test_a_severe_signal_is_held_as_critical(self):
        decision = policy.decide(_signal(hate=0.9), OLD, 0)
        assert (decision.status, decision.priority) == (status.HELD, policy.PRIORITY_CRITICAL)

    @pytest.mark.parametrize("category", policy.CRITICAL_CATEGORIES)
    def test_even_a_low_critical_category_score_is_held_as_critical(self, category):
        decision = policy.decide(_signal(**{category: 0.15}), OLD, 0)
        assert (decision.status, decision.priority) == (status.HELD, policy.PRIORITY_CRITICAL)

    def test_open_reports_against_the_account_hold_otherwise_clean_content(self):
        decision = policy.decide(_signal(sexual=0.0), OLD, 1)
        assert decision.status == status.HELD

    def test_an_unusable_signal_or_no_signal_goes_to_a_person(self):
        assert policy.decide(None, OLD, 0).status == status.HELD
        assert policy.decide(Signal.unclassified("f", "v"), OLD, 0).status == status.HELD

    def test_a_new_account_has_a_lower_threshold_for_doubt(self):
        signal = _signal(sexual=0.2)  # limpio para una cuenta con historial
        assert policy.decide(signal, OLD, 0).status == status.APPROVED
        assert policy.decide(signal, NEW, 0).status == status.HELD

    def test_the_new_account_window_is_seven_days_by_default(self):
        signal = _signal(sexual=0.2)
        assert policy.decide(signal, 6.9, 0).status == status.HELD
        assert policy.decide(signal, 7.1, 0).status == status.APPROVED

    def test_a_new_account_with_a_clean_signal_is_approved_unless_hold_all_is_set(self):
        signal = _signal(sexual=0.0)
        assert policy.decide(signal, NEW, 0).status == status.APPROVED
        strict = policy.Thresholds(hold_all_new=True)
        decision = policy.decide(signal, NEW, 0, strict)
        assert (decision.status, decision.reason) == (status.HELD, "new_account")

    def test_the_engine_never_rejects_and_never_approves_when_in_doubt(self):
        """Propiedad: en toda combinación, el resultado es approved|held (nunca rejected), y
        approved solo si la señal es utilizable, limpia y sin reportes."""
        levels = (0.0, 0.05, 0.1, 0.3, 0.4, 0.6, 0.85, 1.0)
        ages = (0.0, 3.0, 7.0, 30.0, 1000.0)
        for cat, level, age, reports in itertools.product(CATEGORIES, levels, ages, (0, 1, 5)):
            decision = policy.decide(_signal(**{cat: level}), age, reports)
            assert decision.status in status.AUTOMATIC
            assert decision.status != status.REJECTED
            if decision.status == status.APPROVED:
                assert level < 0.40 and reports == 0
                assert not (cat in policy.CRITICAL_CATEGORIES and level >= 0.10)


class TestInitialStatus:
    def test_with_moderation_off_content_is_published_as_before(self):
        assert status.initial_status(False) == status.APPROVED

    def test_with_moderation_on_new_content_waits(self):
        assert status.initial_status(True) == status.PENDING

    def test_automatic_decisions_cannot_reject(self):
        assert status.REJECTED not in status.AUTOMATIC
        assert status.REJECTED in status.HUMAN


class TestBackoff:
    def test_waits_grow_and_are_capped(self):
        assert [jobs.backoff_seconds(n, 30) for n in (1, 2, 3, 4)] == [30, 60, 120, 240]
        assert jobs.backoff_seconds(30, 30) == 3600

    def test_the_idempotency_key_is_stable(self):
        a = jobs.idempotency_key(jobs.KIND_IMAGE, jobs.SUBJECT_MEDIA_ATTACHMENT, "abc")
        assert a == jobs.idempotency_key(jobs.KIND_IMAGE, jobs.SUBJECT_MEDIA_ATTACHMENT, "abc")
