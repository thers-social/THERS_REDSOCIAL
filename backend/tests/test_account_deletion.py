# Pruebas de integración de la eliminación de cuenta
# (ADR-031-account-deletion.md) contra PostgreSQL real (ver conftest.py).
#
# El código de correo nunca lo devuelve la API (viaja por correo), así que, como
# en test_password_reset.py, las pruebas de `confirm` insertan la fila del código
# con las mismas funciones de dominio que usa el código real (`hash_password`).
# `POST /api/account-deletion/request` sí se prueba de punta a punta, limitado a
# lo observable desde afuera: la respuesta y el estado de la base.

import io
import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pyotp
import pytest
from PIL import Image

from app.domain.auth.auth_service import hash_password
from app.extensions import db
from app.infrastructure.persistence.models import (
    AccountDeletionCode,
    Comment,
    Message,
    Post,
    RateLimitBucket,
    User,
)
from tests.conftest import mark_email_verified
from tests.test_google_auth import _mock_google_identity
from tests.test_security import _enable_two_factor

PASSWORD = "secretpass"
CODE = "123456"
WORD = "DELETE"


def _h(token):
    return {"Authorization": f"Bearer {token}"}


def _payload(**overrides):
    payload = {
        "name": "Ada Lovelace",
        "username": "ada_lovelace",
        "email": "ada@example.com",
        "phone": "7000-1234",
        "country_code": "+503",
        "birth_date": "1990-01-01",
        "password": PASSWORD,
        "confirm_password": PASSWORD,
    }
    payload.update(overrides)
    return payload


def _make_user(client, **overrides):
    """Registra, verifica el correo e inicia sesión. Devuelve un dict con lo que
    las pruebas necesitan."""
    payload = _payload(**overrides)
    created = client.post("/api/register", json=payload)
    assert created.status_code == 201, created.get_json()
    user_id = created.get_json()["user"]["id"]
    mark_email_verified(user_id)
    login = client.post("/api/login", json={"email": payload["email"], "password": PASSWORD})
    body = login.get_json()
    return {
        "id": user_id,
        "email": payload["email"],
        "token": body["token"],
        "refresh": body["refresh_token"],
    }


def _insert_code(app, user_id, code=CODE, minutes=10, attempts=0):
    with app.app_context():
        row = AccountDeletionCode(
            user_id=uuid.UUID(user_id),
            code_hash=hash_password(code),
            attempts=attempts,
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=minutes),
        )
        db.session.add(row)
        db.session.commit()
        return str(row.id)


def _confirm(client, email, **overrides):
    body = {
        "email": email,
        "code": CODE,
        "confirm_email": email,
        "confirmation": WORD,
    }
    body.update(overrides)
    return client.post("/api/account-deletion/confirm", json=body)


def _user_exists(app, user_id):
    with app.app_context():
        return db.session.get(User, uuid.UUID(user_id)) is not None


def _png():
    buffer = io.BytesIO()
    Image.new("RGB", (400, 400), (10, 120, 200)).save(buffer, format="PNG")
    buffer.seek(0)
    return buffer


def _stored_files():
    root = Path(os.environ["UPLOAD_DIR"])
    return {p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file()}


# ===========================================================================
# Paso 1 — pedir el código
# ===========================================================================
class TestRequestCode:
    def test_existing_and_unknown_accounts_get_the_same_answer(self, app, client):
        _make_user(client)

        real = client.post("/api/account-deletion/request", json={"email": "ada@example.com"})
        fake = client.post("/api/account-deletion/request", json={"email": "nadie@example.com"})

        assert real.status_code == fake.status_code == 200
        assert real.get_json() == fake.get_json()

    def test_a_code_is_stored_only_for_a_real_account_and_never_in_clear(self, app, client):
        user = _make_user(client)
        client.post("/api/account-deletion/request", json={"email": user["email"]})
        client.post("/api/account-deletion/request", json={"email": "nadie@example.com"})

        with app.app_context():
            rows = db.session.query(AccountDeletionCode).all()
            assert len(rows) == 1
            assert str(rows[0].user_id) == user["id"]
            assert rows[0].attempts == 0
            # scrypt con sal: nunca seis dígitos en claro.
            assert not rows[0].code_hash.isdigit()
            assert len(rows[0].code_hash) > 30

    def test_cooldown_does_not_create_a_second_code(self, app, client):
        user = _make_user(client)
        client.post("/api/account-deletion/request", json={"email": user["email"]})
        client.post("/api/account-deletion/request", json={"email": user["email"]})

        with app.app_context():
            assert db.session.query(AccountDeletionCode).count() == 1

    def test_requires_a_valid_email(self, client):
        assert client.post("/api/account-deletion/request", json={}).status_code == 400
        assert (
            client.post("/api/account-deletion/request", json={"email": "no-es-correo"}).status_code
            == 400
        )

    def test_it_is_rate_limited_per_ip(self, client):
        for _ in range(5):
            assert (
                client.post(
                    "/api/account-deletion/request", json={"email": "nadie@example.com"}
                ).status_code
                == 200
            )

        limited = client.post("/api/account-deletion/request", json={"email": "nadie@example.com"})

        assert limited.status_code == 429
        assert "Retry-After" in limited.headers


# ===========================================================================
# Paso 2 — confirmar y eliminar
# ===========================================================================
class TestConfirmDeletion:
    def test_deletes_the_account_and_everything_that_depends_on_it(self, app, client):
        ada = _make_user(client)
        bob = _make_user(client, username="bob_b", email="bob@example.com")

        # Datos de Ada: publicación, comentario ajeno sobre ella, mensajes en los dos sentidos.
        post = client.post("/api/posts", json={"content": "mi post"}, headers=_h(ada["token"]))
        post_id = post.get_json()["post"]["id"]
        client.post(
            f"/api/posts/{post_id}/comments", json={"content": "de bob"}, headers=_h(bob["token"])
        )
        client.post(
            f"/api/users/{bob['id']}/messages", json={"content": "hola bob"}, headers=_h(ada["token"])
        )
        client.post(
            f"/api/users/{ada['id']}/messages", json={"content": "hola ada"}, headers=_h(bob["token"])
        )
        # Datos de Bob que NO deben tocarse.
        bob_post = client.post("/api/posts", json={"content": "de bob"}, headers=_h(bob["token"]))
        bob_post_id = bob_post.get_json()["post"]["id"]
        # Ada sigue a Bob: la relación debe desaparecer sin afectar a Bob.
        client.post(f"/api/users/{bob['id']}/follow", headers=_h(ada["token"]))

        _insert_code(app, ada["id"])
        response = _confirm(client, ada["email"])

        assert response.status_code == 200
        with app.app_context():
            assert db.session.get(User, uuid.UUID(ada["id"])) is None
            # Todo lo de Ada, en los dos lados de la conversación.
            assert db.session.query(Message).count() == 0
            remaining_posts = db.session.query(Post).all()
            assert [str(p.id) for p in remaining_posts] == [bob_post_id]
            # El comentario de Bob sobre el post de Ada se fue con el post.
            assert db.session.query(Comment).count() == 0
            # Bob y su contenido siguen intactos.
            assert db.session.get(User, uuid.UUID(bob["id"])) is not None

    def test_sessions_and_tokens_stop_working_immediately(self, app, client):
        ada = _make_user(client)
        _insert_code(app, ada["id"])

        assert client.get("/api/users/me", headers=_h(ada["token"])).status_code == 200
        assert _confirm(client, ada["email"]).status_code == 200

        # El access token deja de valer YA, no a los 15 minutos.
        assert client.get("/api/users/me", headers=_h(ada["token"])).status_code == 401
        # El refresh token tampoco puede renovar nada.
        assert client.post("/api/refresh", headers=_h(ada["refresh"])).status_code == 401
        # Y no se puede volver a entrar.
        login = client.post("/api/login", json={"email": ada["email"], "password": PASSWORD})
        assert login.status_code == 401

    def test_avatar_and_cover_files_are_deleted_from_storage(self, app, client):
        ada = _make_user(client)
        for kind in ("avatar", "cover"):
            uploaded = client.post(
                f"/api/users/me/{kind}",
                data={"file": (_png(), "foto.png", "image/png")},
                headers=_h(ada["token"]),
                content_type="multipart/form-data",
            )
            assert uploaded.status_code == 200
        assert len(_stored_files()) == 2

        _insert_code(app, ada["id"])
        assert _confirm(client, ada["email"]).status_code == 200

        assert _stored_files() == set()

    def test_the_users_rate_limit_counters_are_removed(self, app, client):
        ada = _make_user(client)
        with app.app_context():
            from app.infrastructure.persistence.repositories.rate_limit_repository import (
                SQLAlchemyRateLimitRepository,
            )

            SQLAlchemyRateLimitRepository().hit("report_create", f"user:{ada['id']}", 3600)
            assert db.session.query(RateLimitBucket).count() >= 1

        _insert_code(app, ada["id"])
        assert _confirm(client, ada["email"]).status_code == 200

        with app.app_context():
            from app.infrastructure.persistence.repositories.rate_limit_repository import (
                _hash_identity,
            )

            leftovers = (
                db.session.query(RateLimitBucket)
                .filter(RateLimitBucket.identity_hash == _hash_identity(f"user:{ada['id']}"))
                .count()
            )
            assert leftovers == 0

    def test_a_google_only_account_without_password_can_be_deleted(self, app, client, monkeypatch):
        _mock_google_identity(monkeypatch, sub="g-1", email="goog@example.com")
        google = client.post("/api/auth/google", json={"credential": "x"})
        assert google.status_code == 200
        user_id = google.get_json()["user"]["id"]
        assert google.get_json()["user"]["has_password"] is False

        _insert_code(app, user_id)
        response = _confirm(client, "goog@example.com")

        assert response.status_code == 200
        assert not _user_exists(app, user_id)

    def test_the_code_cannot_be_used_twice(self, app, client):
        ada = _make_user(client)
        _insert_code(app, ada["id"])
        assert _confirm(client, ada["email"]).status_code == 200

        # La cuenta ya no existe: mismo error genérico, sin pistas.
        assert _confirm(client, ada["email"]).status_code == 400

    # --- código de correo -------------------------------------------------
    def test_a_wrong_code_is_rejected_and_counts_an_attempt(self, app, client):
        ada = _make_user(client)
        _insert_code(app, ada["id"])

        response = _confirm(client, ada["email"], code="000000")

        assert response.status_code == 400
        assert _user_exists(app, ada["id"])
        with app.app_context():
            assert db.session.query(AccountDeletionCode).one().attempts == 1

    def test_after_five_failures_even_the_right_code_is_rejected(self, app, client):
        ada = _make_user(client)
        _insert_code(app, ada["id"], attempts=5)

        assert _confirm(client, ada["email"]).status_code == 400
        assert _user_exists(app, ada["id"])

    def test_an_expired_code_is_rejected(self, app, client):
        ada = _make_user(client)
        _insert_code(app, ada["id"], minutes=-1)

        assert _confirm(client, ada["email"]).status_code == 400
        assert _user_exists(app, ada["id"])

    def test_without_a_requested_code_it_is_rejected(self, app, client):
        ada = _make_user(client)

        assert _confirm(client, ada["email"]).status_code == 400
        assert _user_exists(app, ada["id"])

    def test_unknown_email_gets_the_same_error_as_a_wrong_code(self, app, client):
        ada = _make_user(client)
        _insert_code(app, ada["id"])

        unknown = _confirm(client, "nadie@example.com")
        wrong = _confirm(client, ada["email"], code="000000")

        assert unknown.status_code == wrong.status_code == 400
        assert unknown.get_json() == wrong.get_json()

    # --- escribir el correo y DELETE -----------------------------------------
    @pytest.mark.parametrize("word", ["delete", "Delete", "DELETE ", " DELETE", "ELIMINAR", "", None])
    def test_the_confirmation_word_must_be_exactly_DELETE(self, app, client, word):
        ada = _make_user(client)
        _insert_code(app, ada["id"])

        response = _confirm(client, ada["email"], confirmation=word)

        assert response.status_code == 400
        assert response.get_json()["confirmation_error"] is True
        assert _user_exists(app, ada["id"])

    @pytest.mark.parametrize("typed", ["otro@example.com", "", None, 123])
    def test_the_retyped_email_must_match_the_account(self, app, client, typed):
        ada = _make_user(client)
        _insert_code(app, ada["id"])

        response = _confirm(client, ada["email"], confirm_email=typed)

        assert response.status_code == 400
        assert response.get_json()["confirmation_error"] is True
        assert _user_exists(app, ada["id"])

    def test_the_retyped_email_is_compared_ignoring_case(self, app, client):
        ada = _make_user(client)
        _insert_code(app, ada["id"])

        assert _confirm(client, ada["email"], confirm_email="ADA@Example.com").status_code == 200

    def test_a_confirmation_mistake_does_not_consume_the_code(self, app, client):
        ada = _make_user(client)
        _insert_code(app, ada["id"])

        assert _confirm(client, ada["email"], confirmation="nope").status_code == 400
        assert _confirm(client, ada["email"]).status_code == 200

    def test_a_wrong_code_never_reveals_confirmation_errors(self, app, client):
        # Solo con el código ya verificado se dan errores específicos.
        ada = _make_user(client)
        _insert_code(app, ada["id"])

        response = _confirm(client, ada["email"], code="000000", confirmation="nope")

        assert "confirmation_error" not in response.get_json()

    # --- segundo factor ------------------------------------------------------
    def test_with_two_factor_the_second_factor_is_required(self, app, client):
        ada = _make_user(client)
        _enable_two_factor(client, ada["token"])
        _insert_code(app, ada["id"])

        response = _confirm(client, ada["email"])

        assert response.status_code == 403
        assert response.get_json()["two_factor_required"] is True
        assert _user_exists(app, ada["id"])

    def test_missing_second_factor_does_not_consume_the_email_code(self, app, client):
        ada = _make_user(client)
        secret, _ = _enable_two_factor(client, ada["token"])
        _insert_code(app, ada["id"])

        assert _confirm(client, ada["email"]).status_code == 403
        done = _confirm(client, ada["email"], two_factor_code=pyotp.TOTP(secret).now())

        assert done.status_code == 200
        assert not _user_exists(app, ada["id"])

    def test_a_wrong_second_factor_is_rejected_without_a_401(self, app, client):
        # 401 haría que un cliente con sesión intente renovarla y la cierre.
        ada = _make_user(client)
        _enable_two_factor(client, ada["token"])
        _insert_code(app, ada["id"])

        response = _confirm(client, ada["email"], two_factor_code="000000")

        assert response.status_code == 400
        assert _user_exists(app, ada["id"])

    def test_a_recovery_code_works_as_second_factor(self, app, client):
        ada = _make_user(client)
        _, recovery_codes = _enable_two_factor(client, ada["token"])
        _insert_code(app, ada["id"])

        response = _confirm(client, ada["email"], two_factor_code=recovery_codes[0])

        assert response.status_code == 200
        assert not _user_exists(app, ada["id"])

    def test_with_a_wrong_email_code_two_factor_is_not_revealed(self, app, client):
        ada = _make_user(client)
        _enable_two_factor(client, ada["token"])
        _insert_code(app, ada["id"])

        response = _confirm(client, ada["email"], code="000000")

        assert response.status_code == 400
        assert "two_factor_required" not in response.get_json()

    # --- límite de intentos -----------------------------------------------------
    def test_confirm_is_rate_limited_per_account(self, app, client):
        ada = _make_user(client)
        _insert_code(app, ada["id"])
        for _ in range(5):
            assert _confirm(client, ada["email"], code="000000").status_code in (400, 429)

        limited = _confirm(client, ada["email"], code="000000")

        assert limited.status_code == 429
        assert "Retry-After" in limited.headers

    def test_missing_fields_are_400(self, client):
        assert client.post("/api/account-deletion/confirm", json={}).status_code == 400
        assert (
            client.post("/api/account-deletion/confirm", json={"email": "a@b.co"}).status_code == 400
        )


# ===========================================================================
# ADR-031 §4 — garantía contra el olvido de tablas nuevas
# ===========================================================================
class TestEveryTableThatPointsToUsersIsDeleted:
    def test_every_foreign_key_to_users_cascades(self, app):
        """Si alguien agrega una tabla con una clave foránea hacia `users` sin
        `ON DELETE CASCADE` (o con RESTRICT), borrar una cuenta fallaría o dejaría
        datos personales atrás. Esta prueba falla antes de que llegue a producción."""
        with app.app_context():
            rows = db.session.execute(
                db.text(
                    """
                    SELECT conrelid::regclass::text AS tabla, conname, confdeltype
                    FROM pg_constraint
                    WHERE contype = 'f' AND confrelid = 'users'::regclass
                    """
                )
            ).all()

        assert rows, "no se encontraron claves foráneas hacia users"
        # Excepción EXPLÍCITA y documentada (ADR-032 §1): un reporte debe SOBREVIVIR a la
        # eliminación de las cuentas involucradas, así que `reports` usa SET NULL ('n').
        # Y `places` (ADR-040 §4.2): un lugar del catálogo debe SOBREVIVIR a quien lo creó o
        # verificó. `created_by_user_id`/`verified_by_user_id` quedan en NULL al borrar la cuenta,
        # así que no se conserva ningún dato de esa persona (la intención de ADR-031).
        # También `place_reports` y `admin_audit_log` (ADR-040 fase 2): el reporte de un lugar
        # y el registro de auditoría deben sobrevivir a la cuenta de quien los generó; la
        # referencia a la persona queda en NULL.
        set_null_on_purpose = {"reports", "places", "place_reports", "admin_audit_log"}
        not_cascading = [
            (t, n) for t, n, d in rows if d != "c" and not (t in set_null_on_purpose and d == "n")
        ]
        assert not_cascading == [], (
            "Estas claves foráneas hacia users no son ON DELETE CASCADE y la eliminación "
            f"de cuenta dejaría datos atrás: {not_cascading}"
        )

    def test_no_table_stores_a_user_reference_without_a_foreign_key(self, app):
        """Una columna `*_user_id`/`user_id` sin clave foránea quedaría huérfana al
        borrar la cuenta. Las únicas excepciones conocidas están listadas aquí, con
        el motivo; agregar otra obliga a decidir cómo se borra."""
        known_without_fk = {
            # `rate_limit_buckets` identifica por hash de "user:<id>" y se limpia
            # explícitamente en SQLAlchemyAccountDeleter.
        }
        with app.app_context():
            columns = db.session.execute(
                db.text(
                    """
                    SELECT c.table_name, c.column_name
                    FROM information_schema.columns c
                    WHERE c.table_schema = 'public'
                      AND c.data_type = 'uuid'
                      AND (c.column_name = 'user_id' OR c.column_name LIKE '%\\_user\\_id')
                    """
                )
            ).all()
            with_fk = {
                (str(t).split(".")[-1], a)
                for t, a in db.session.execute(
                    db.text(
                        """
                        SELECT conrelid::regclass::text,
                               (SELECT attname FROM pg_attribute
                                 WHERE attrelid = conrelid AND attnum = conkey[1])
                        FROM pg_constraint
                        WHERE contype = 'f' AND confrelid = 'users'::regclass
                        """
                    )
                ).all()
            }

        orphans = [(t, c) for t, c in columns if (t, c) not in with_fk and (t, c) not in known_without_fk]
        assert orphans == [], f"Columnas con referencia a un usuario sin clave foránea: {orphans}"
