# Ayudantes de las pruebas de moderación de contenido (ADR-044). PostgreSQL real, sin mocks.

import io
from datetime import datetime, timedelta, timezone

import pytest
from PIL import Image
from sqlalchemy import text

from app.application.content_moderation.settings import ModerationSettings
from app.application.media.image_visibility import configure_moderation
from app.extensions import db
from app.infrastructure.content_moderation.fake_classifiers import FakeImageClassifier
from app.infrastructure.persistence.models import User
from app.infrastructure.persistence.repositories.content_moderation_repository import (
    SQLAlchemyContentModerationRepository,
)
from tests.test_messages import _auth_headers, _register_and_login


def png(color=(200, 30, 30)):
    out = io.BytesIO()
    Image.new("RGB", (40, 30), color).save(out, format="PNG")
    return out.getvalue()


@pytest.fixture()
def moderation_on(app):
    """Enciende la moderación para esta prueba y la apaga al terminar."""
    app.config["MODERATION_ENABLED"] = True
    configure_moderation(True)
    yield
    app.config["MODERATION_ENABLED"] = False
    configure_moderation(False)


@pytest.fixture()
def repository():
    return SQLAlchemyContentModerationRepository()


@pytest.fixture()
def settings():
    return ModerationSettings(enabled=True, max_attempts=3, backoff_base=30, lease_seconds=300)


@pytest.fixture()
def classifier():
    return FakeImageClassifier()


def now():
    return datetime.now(timezone.utc)


def make_account(client, username, age_days=400):
    """Cuenta verificada; `age_days` retrasa su `created_at` para probar cuentas nuevas y viejas."""
    token, user_id = _register_and_login(client, username=username, email=f"{username}@example.com")
    db.session.execute(
        text("UPDATE users SET created_at = now() - make_interval(days => :d) WHERE id = :id"),
        {"d": age_days, "id": user_id},
    )
    db.session.commit()
    return token, user_id


def make_moderator(user_id, value=True):
    user = db.session.get(User, user_id)
    user.is_moderator = value
    db.session.commit()


def publish_post_with_image(client, token, content="foto"):
    response = client.post(
        "/api/posts",
        data={"content": content, "images": [(io.BytesIO(png()), "foto.png")]},
        content_type="multipart/form-data",
        headers=_auth_headers(token),
    )
    assert response.status_code == 201, response.get_json()
    return response.get_json()["post"]


def attachments():
    return db.session.execute(
        text("SELECT id, storage_key, owner_id, moderation_status FROM media_attachments "
             "ORDER BY created_at")
    ).mappings().all()


def jobs_table():
    return db.session.execute(
        text("SELECT * FROM moderation_jobs ORDER BY created_at")
    ).mappings().all()
