# Los tests corren contra PostgreSQL 16 real en Docker (thers_test, ver
# docker/postgres-init/01-create-test-db.sql) — no contra mocks ni SQLite.
# DATABASE_URL se fija explícitamente a `thers_test` aquí, ignorando
# cualquier DATABASE_URL heredada del entorno (p. ej. apuntando a
# thers_dev), para que un test nunca pueda tocar datos de desarrollo por
# accidente. TEST_DATABASE_URL permite apuntar a otra instancia si hace falta.
#
# El puerto NO está hardcodeado a 5432: `docker-compose.yml` publica el
# contenedor en `${POSTGRES_PORT:-5432}`, y en cualquier máquina con un
# PostgreSQL nativo instalado el 5432 del host ya está ocupado (CLAUDE.md §11
# documenta justamente ese caso y recomienda 5433). Con el puerto fijo, correr
# `pytest` en una máquina así no fallaba de forma obvia: intentaba conectarse
# al PostgreSQL **nativo** en vez de al del proyecto. Se lee la misma variable
# que usa Compose, desde el `.env` de la raíz del repositorio, para que un solo
# valor gobierne los dos lados.

import os
from pathlib import Path

from dotenv import load_dotenv

# `.env` de la RAÍZ (el que lee Compose), no `backend/.env` -- ahí vive
# POSTGRES_PORT. `override=False` (default): una variable ya presente en el
# entorno real siempre gana.
load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")

_POSTGRES_PORT = os.environ.get("POSTGRES_PORT", "5432")

os.environ["JWT_SECRET_KEY"] = "test-secret-key-not-for-real-use"
os.environ["DATABASE_URL"] = os.environ.get(
    "TEST_DATABASE_URL",
    f"postgresql+psycopg://thers:changeme@localhost:{_POSTGRES_PORT}/thers_test",
)

# Fijada explícitamente en vacío, ANTES del primer import de `app` (que
# dispara app/config.py -> load_dotenv(), ADR-009-password-reset-and-email-verification.md)
# -- load_dotenv() nunca pisa una variable que ya está en os.environ
# (override=False), así que esto garantiza que la suite use siempre
# NullEmailSender (infrastructure/email/factory.py), sin importar si el
# `backend/.env` real de quien corre los tests tiene una RESEND_API_KEY de
# verdad cargada. Sin esto, correr `pytest` en una máquina con Resend
# configurado para desarrollo intentaría enviar correos reales durante la
# suite -- exactamente lo que DATABASE_URL de arriba ya evita para Postgres.
os.environ["RESEND_API_KEY"] = ""

# Imágenes de perfil (ADR-015): siempre disco local en un directorio
# temporal, nunca el backend/uploads real ni un bucket S3 del entorno.
import tempfile

os.environ["STORAGE_BACKEND"] = "local"
os.environ["UPLOAD_DIR"] = tempfile.mkdtemp(prefix="thers_test_uploads_")
os.environ["MEDIA_PUBLIC_BASE_URL"] = "http://testserver/api/media"

import psycopg
import pytest

from app import create_app
from app.extensions import db


def reset_rate_limits():
    """Borra todos los contadores de rate limiting (ADR-027-rate-limiting.md).

    `_clean_tables` ya trunca `rate_limit_buckets` ENTRE tests, así que la
    inmensa mayoría no necesita esto. Hace falta solo dentro de un test que
    legítimamente hace más peticiones de las que un límite permite -- por
    ejemplo uno que registra doce usuarios para probar el tope de menciones,
    cuando `policy.REGISTER` permite cinco por hora.

    Se expone como helper explícito en vez de subir los límites: un límite que
    se relaja para que los tests pasen deja de ser el límite que protege
    producción, y esa diferencia es justo la que nadie recuerda después.
    """
    from app.extensions import db
    from app.infrastructure.persistence.models import RateLimitBucket

    db.session.query(RateLimitBucket).delete()
    db.session.commit()


def mark_email_verified(user_id):
    """Verifica el email de `user_id` directamente en la base, sin pasar
    por el flujo OTP real (ADR-011-mandatory-email-verification.md) --
    desde esa tarea, `login_use_case.py` rechaza cualquier cuenta con
    `email_verified=false`, y el código real de verificación nunca es
    observable por un test (viaja solo por correo; `NullEmailSender` no lo
    registra en ningún lado que un test pueda leer). La inmensa mayoría de
    los tests de este proyecto no están probando el flujo de registro/
    verificación en sí (eso lo cubre `test_registration.py`) -- solo
    necesitan una cuenta ya utilizable para poder probar otra cosa (posts,
    likes, perfil, etc.), igual que ya pasaba antes de ADR-011.

    Conexión psycopg directa (no `db.session`/Flask-SQLAlchemy): evita que
    cada test que llame a esto necesite además pedir la fixture `app` solo
    para abrir un `app_context()` -- esta función no depende de que haya una
    app Flask activa, solo de la misma `DATABASE_URL` que ya usa toda la
    suite (fijada arriba)."""
    dsn = os.environ["DATABASE_URL"].replace("postgresql+psycopg://", "postgresql://", 1)
    with psycopg.connect(dsn) as conn:
        conn.execute("UPDATE users SET email_verified = true WHERE id = %s", (user_id,))
        conn.commit()


@pytest.fixture()
def app():
    app = create_app()
    app.config.update(TESTING=True)
    yield app
    # `create_app()` crea un engine/pool de SQLAlchemy nuevo por test (una
    # Flask app nueva por test, sin compartir el engine entre ellos) -- sin
    # liberarlo, las conexiones se acumulan a lo largo de la suite hasta
    # agotar `max_connections` de PostgreSQL (100 por defecto en el
    # contenedor de desarrollo), un fallo que solo aparece con suites
    # grandes, no test por test aislado.
    with app.app_context():
        db.engine.dispose()


@pytest.fixture()
def client(app):
    return app.test_client()


@pytest.fixture(autouse=True)
def _clean_tables(app):
    # Todas las migraciones (backend/migrations/versions/) ya deben estar
    # aplicadas contra thers_test antes de correr los tests (`flask db
    # upgrade` con DATABASE_URL=.../thers_test) — este fixture solo limpia
    # filas entre tests, no crea estructura.
    #
    # `posts` referencia a `users` (author_id, ON DELETE CASCADE,
    # ADR-004-posts-minimal-model.md), `likes` y `comments` referencian a
    # ambas (ADR-005/ADR-006), `follows` referencia dos veces a `users`
    # (follower_id/followed_id, ON DELETE CASCADE, ADR-007-follows-minimal-model.md),
    # `notifications` referencia a `users` dos veces (recipient_id/actor_id)
    # y a `posts` una vez (ADR-008-notifications-minimal-model.md), y
    # `password_reset_tokens`/`email_verification_tokens` referencian a
    # `users` una vez cada una (ADR-009-password-reset-and-email-verification.md),
    # `user_identities` referencia a `users` una vez
    # (ADR-012-google-sign-in.md), `mentions` referencia a `users` dos veces y
    # a `posts`/`comments` una cada una (ADR-023-mentions.md) y
    # `muted_keywords` referencia a `users` una vez
    # (ADR-024-content-filters-and-privacy-preferences.md), y `sessions`
    # (ADR-025-session-registry.md) y `two_factor_recovery_codes`
    # (ADR-026-two-factor-authentication.md) referencian a `users` una vez cada
    # una, y `rate_limit_buckets` (ADR-027-rate-limiting.md) no referencia a
    # ninguna (su identidad es un hash, puede ser una IP o un email inexistente)
    # pero se trunca igual: si no, los contadores de un test se arrastrarian al
    # siguiente y un test con varios intentos de login empezaria ya limitado --
    # un TRUNCATE de una sola tabla falla si
    # otra tiene filas dependientes, salvo que todas se trunquen juntas en
    # la misma sentencia (Postgres lo permite sin necesitar CASCADE en el
    # propio TRUNCATE cuando la tabla referenciante también está en la
    # lista).
    yield
    with app.app_context():
        db.session.execute(
            db.text(
                "TRUNCATE TABLE refresh_tokens, password_reset_tokens, email_verification_tokens, "
                "account_deletion_codes, "
                "user_identities, notifications, messages, mentions, muted_keywords, "
                "sessions, two_factor_recovery_codes, rate_limit_buckets, data_exports, user_restrictions, muted_topics, "
                "media_attachments, "
                "comments, likes, follows, posts, reports, saved_places, place_reports, admin_audit_log, places, users"
            )
        )
        db.session.commit()


@pytest.fixture(autouse=True)
def _clean_uploads():
    # ADR-015: cada test parte con el directorio de imágenes vacío.
    import shutil

    yield
    root = os.environ["UPLOAD_DIR"]
    for entry in os.listdir(root):
        shutil.rmtree(os.path.join(root, entry), ignore_errors=True)
