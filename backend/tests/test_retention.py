# Pruebas del plazo de conservación de 90 días (ADR-037-data-retention.md) contra
# PostgreSQL real. Se verifica lo que se BORRA y, igual de importante, lo que NO.

import hashlib
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from app.application.retention.purge_use_case import purge_expired_data
from app.domain.retention.policy import SESSION_RETENTION_DAYS
from app.extensions import db
from app.infrastructure.persistence.models import (
    EmailVerificationToken,
    PasswordResetToken,
    RefreshToken,
    Session,
    User,
)
from app.infrastructure.persistence.repositories.retention_repository import (
    SQLAlchemyRetentionRepository,
)
from app.interfaces import retention_trigger
from tests.conftest import mark_email_verified

NOW = datetime(2026, 10, 2, 12, 0, tzinfo=timezone.utc)


def _ago(days):
    return NOW - timedelta(days=days)


def _user(app):
    with app.app_context():
        user = User(
            name="Ada", username="ada_ret", email="ada.ret@example.com", email_verified=True,
            profile_completed=True,
        )
        db.session.add(user)
        db.session.commit()
        return user.id


def _session(user_id, created, last_used=None, revoked=None, ip="203.0.113.7"):
    return Session(
        user_id=user_id,
        jti=uuid.uuid4().hex[:36],
        user_agent="Mozilla/5.0 (Linux; Android 14; SM-A166B)",
        ip_address=ip,
        created_at=created,
        last_used_at=last_used,
        revoked_at=revoked,
    )


def _refresh(user_id, created):
    return RefreshToken(
        user_id=user_id,
        family_id=uuid.uuid4(),
        token_hash=hashlib.sha256(uuid.uuid4().bytes).hexdigest(),
        created_at=created,
        expires_at=created + timedelta(days=30),
    )


def _count(model):
    return db.session.query(model).count()


def test_the_retention_period_is_ninety_days():
    assert SESSION_RETENTION_DAYS == 90


class TestSessions:
    def test_a_session_unused_for_more_than_ninety_days_is_deleted(self, app):
        user_id = _user(app)
        with app.app_context():
            db.session.add(_session(user_id, created=_ago(200), last_used=_ago(91)))
            db.session.commit()

            counts = purge_expired_data(SQLAlchemyRetentionRepository(), now=NOW)

            assert counts["sessions"] == 1
            assert _count(Session) == 0

    def test_a_recently_used_session_is_kept_even_if_it_is_old(self, app):
        # Lleva meses abierta pero se usó ayer: es una sesión viva, no un dato vencido.
        user_id = _user(app)
        with app.app_context():
            db.session.add(_session(user_id, created=_ago(400), last_used=_ago(1)))
            db.session.commit()

            purge_expired_data(SQLAlchemyRetentionRepository(), now=NOW)

            assert _count(Session) == 1

    def test_the_boundary_is_ninety_days(self, app):
        user_id = _user(app)
        with app.app_context():
            db.session.add(_session(user_id, created=_ago(100), last_used=_ago(89)))
            db.session.add(_session(user_id, created=_ago(100), last_used=_ago(91)))
            db.session.commit()

            purge_expired_data(SQLAlchemyRetentionRepository(), now=NOW)

            assert _count(Session) == 1

    def test_a_closed_session_is_deleted_ninety_days_after_it_was_closed(self, app):
        user_id = _user(app)
        with app.app_context():
            # Cerrada hace 100 días -> se borra. Cerrada hace 10 -> se conserva aunque
            # su último uso sea más viejo (el plazo corre desde que se cerró).
            db.session.add(_session(user_id, created=_ago(300), last_used=_ago(150), revoked=_ago(100)))
            db.session.add(_session(user_id, created=_ago(300), last_used=_ago(150), revoked=_ago(10)))
            db.session.commit()

            purge_expired_data(SQLAlchemyRetentionRepository(), now=NOW)

            assert _count(Session) == 1


class TestTokens:
    def test_old_refresh_tokens_are_deleted_and_recent_ones_kept(self, app):
        user_id = _user(app)
        with app.app_context():
            db.session.add(_refresh(user_id, _ago(95)))
            db.session.add(_refresh(user_id, _ago(10)))
            db.session.commit()

            counts = purge_expired_data(SQLAlchemyRetentionRepository(), now=NOW)

            assert counts["refresh_tokens"] == 1
            assert _count(RefreshToken) == 1

    def test_old_one_time_codes_are_deleted_and_recent_ones_kept(self, app):
        user_id = _user(app)
        with app.app_context():
            for model in (PasswordResetToken, EmailVerificationToken):
                db.session.add(model(
                    user_id=user_id, code_hash="x", expires_at=_ago(94), created_at=_ago(95),
                    used_at=_ago(94),
                ))
                db.session.add(model(
                    user_id=user_id, code_hash="y", expires_at=NOW + timedelta(minutes=5),
                    created_at=_ago(0),
                ))
            db.session.commit()

            counts = purge_expired_data(SQLAlchemyRetentionRepository(), now=NOW)

            assert counts["password_reset_tokens"] == counts["email_verification_tokens"] == 1
            assert _count(PasswordResetToken) == _count(EmailVerificationToken) == 1


class TestWhatIsNeverTouched:
    def test_accounts_are_never_deleted(self, app):
        user_id = _user(app)
        with app.app_context():
            db.session.add(_session(user_id, created=_ago(500), last_used=_ago(400)))
            db.session.commit()

            purge_expired_data(SQLAlchemyRetentionRepository(), now=NOW)

            assert db.session.get(User, user_id) is not None

    def test_the_returned_counts_never_include_personal_data(self, app):
        user_id = _user(app)
        with app.app_context():
            db.session.add(_session(user_id, created=_ago(200), last_used=_ago(150), ip="198.51.100.9"))
            db.session.commit()

            counts = purge_expired_data(SQLAlchemyRetentionRepository(), now=NOW)

            assert all(isinstance(value, int) for value in counts.values())
            assert "198.51.100.9" not in str(counts)

    def test_running_it_twice_is_harmless(self, app):
        user_id = _user(app)
        with app.app_context():
            db.session.add(_session(user_id, created=_ago(200), last_used=_ago(150)))
            db.session.commit()
            repository = SQLAlchemyRetentionRepository()

            purge_expired_data(repository, now=NOW)
            second = purge_expired_data(repository, now=NOW)

            assert second == {
                "sessions": 0, "refresh_tokens": 0, "password_reset_tokens": 0,
                "email_verification_tokens": 0, "tero_pending_actions": 0,
            }


class TestTrigger:
    def test_login_triggers_the_purge_when_the_dice_say_so(self, app, client, monkeypatch):
        monkeypatch.setattr(retention_trigger.random, "randrange", lambda n: 0)
        calls = []
        monkeypatch.setattr(retention_trigger, "purge_expired_data", lambda repo: calls.append(1))
        user_id = _register_and_verify(client)

        response = client.post("/api/login", json={"email": "ada.ret2@example.com", "password": "secretpass"})

        assert response.status_code == 200
        assert calls == [1]
        assert user_id

    def test_a_failing_purge_never_breaks_the_login(self, app, client, monkeypatch):
        monkeypatch.setattr(retention_trigger.random, "randrange", lambda n: 0)

        def boom(repo):
            raise RuntimeError("fallo simulado de la limpieza")

        monkeypatch.setattr(retention_trigger, "purge_expired_data", boom)
        _register_and_verify(client)

        response = client.post("/api/login", json={"email": "ada.ret2@example.com", "password": "secretpass"})

        assert response.status_code == 200
        assert "token" in response.get_json()

    def test_the_script_prints_only_counts(self, app, capsys):
        user_id = _user(app)
        with app.app_context():
            db.session.add(_session(user_id, created=_ago(300), last_used=_ago(200), ip="192.0.2.55"))
            db.session.commit()

        sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
        import purge_expired_data as script

        script.main()
        output = capsys.readouterr().out

        assert "90 días" in output and "sessions: 1" in output
        assert "192.0.2.55" not in output and "Mozilla" not in output


def _register_and_verify(client):
    created = client.post("/api/register", json={
        "name": "Ada", "username": "ada_ret2", "email": "ada.ret2@example.com",
        "phone": "7000-1234", "country_code": "+503", "birth_date": "1990-01-01",
        "password": "secretpass", "confirm_password": "secretpass",
    })
    assert created.status_code == 201
    user_id = created.get_json()["user"]["id"]
    mark_email_verified(user_id)
    return user_id
