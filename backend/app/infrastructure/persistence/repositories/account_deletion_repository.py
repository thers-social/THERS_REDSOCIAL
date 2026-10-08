# Adaptador SQLAlchemy de los puertos de eliminación de cuenta
# (domain/account_deletion/repositories.py, ADR-031-account-deletion.md).

from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError

from app.domain.account_deletion.repositories import (
    AccountDeleter,
    AccountDeletionCodeRepository,
)
from app.extensions import db
from app.infrastructure.persistence.models import AccountDeletionCode, MediaAttachment, User

# Mismo razonamiento que password_reset_repository: dos "pedir código"
# simultáneos pueden chocar con el índice único parcial; se reintenta.
_MAX_CREATE_RETRIES = 3


class SQLAlchemyAccountDeletionCodeRepository(AccountDeletionCodeRepository):
    def create_code(self, user_id, code_hash, expires_at):
        for attempt in range(_MAX_CREATE_RETRIES):
            db.session.execute(
                update(AccountDeletionCode)
                .where(
                    AccountDeletionCode.user_id == user_id,
                    AccountDeletionCode.used_at.is_(None),
                )
                .values(used_at=func.now())
            )
            row = AccountDeletionCode(user_id=user_id, code_hash=code_hash, expires_at=expires_at)
            db.session.add(row)
            try:
                db.session.commit()
            except IntegrityError:
                db.session.rollback()
                if attempt == _MAX_CREATE_RETRIES - 1:
                    raise
                continue
            return row

    def find_active_by_user_id(self, user_id):
        return db.session.execute(
            select(AccountDeletionCode).where(
                AccountDeletionCode.user_id == user_id,
                AccountDeletionCode.used_at.is_(None),
            )
        ).scalar_one_or_none()

    def increment_attempts(self, code_id):
        result = db.session.execute(
            update(AccountDeletionCode)
            .where(AccountDeletionCode.id == code_id)
            .values(attempts=AccountDeletionCode.attempts + 1)
            .returning(AccountDeletionCode.attempts)
        )
        db.session.commit()
        return result.scalar_one()

    def mark_used(self, code_id):
        # La condición `used_at IS NULL` va en el WHERE: de dos confirmaciones
        # simultáneas, solo una cambia la fila.
        result = db.session.execute(
            update(AccountDeletionCode)
            .where(AccountDeletionCode.id == code_id, AccountDeletionCode.used_at.is_(None))
            .values(used_at=func.now())
        )
        db.session.commit()
        return result.rowcount == 1

    def has_recent_unused_code(self, user_id, cooldown_seconds):
        cutoff = datetime.now(timezone.utc) - timedelta(seconds=cooldown_seconds)
        return (
            db.session.execute(
                select(AccountDeletionCode.id).where(
                    AccountDeletionCode.user_id == user_id,
                    AccountDeletionCode.used_at.is_(None),
                    AccountDeletionCode.created_at > cutoff,
                )
            ).first()
            is not None
        )


class SQLAlchemyAccountDeleter(AccountDeleter):
    def __init__(self, rate_limit_repository):
        self._rate_limit_repository = rate_limit_repository

    def delete_account(self, user_id):
        user = db.session.get(User, user_id)
        if user is None:
            return {"media_keys": []}

        media_keys = [key for key in (user.avatar_path, user.cover_path) if key]
        # Imágenes de sus publicaciones y mensajes (ADR-039): las filas caen en
        # cascada con la cuenta, pero los archivos no -- hay que recogerlos antes.
        media_keys += list(
            db.session.execute(
                select(MediaAttachment.storage_key).where(MediaAttachment.owner_id == user_id)
            ).scalars()
        )

        # Un solo DELETE: las 22 claves foráneas hacia `users` son ON DELETE
        # CASCADE (publicaciones, comentarios, me gusta, seguidos, notificaciones,
        # mensajes en ambos lados, tokens, sesiones, identidades de Google,
        # menciones, filtros, exportaciones...). La prueba de
        # tests/test_account_deletion.py recorre `information_schema` y falla si
        # alguna tabla nueva deja de cumplirlo.
        db.session.execute(delete(User).where(User.id == user_id))
        db.session.commit()

        # `rate_limit_buckets` identifica por hash de "user:<id>" y no tiene clave
        # foránea. Es mantenimiento: un fallo acá no deshace la eliminación (las
        # filas caducan solas a las 24 h).
        try:
            self._rate_limit_repository.clear_identity(f"user:{user_id}")
        except Exception:  # noqa: BLE001
            db.session.rollback()

        return {"media_keys": media_keys}
