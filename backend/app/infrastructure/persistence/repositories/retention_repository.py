# Adaptador SQLAlchemy del puerto `RetentionRepository`
# (domain/retention/repositories.py, ADR-037-data-retention.md).

from sqlalchemy import and_, delete, or_

from app.domain.retention.repositories import RetentionRepository
from app.extensions import db
from app.infrastructure.persistence.models import (
    EmailVerificationToken,
    PasswordResetToken,
    RefreshToken,
    Session,
    TeroPendingAction,
)


class SQLAlchemyRetentionRepository(RetentionRepository):
    def purge_older_than(self, cutoff):
        counts = {}

        # Sesiones (llevan IP y agente de usuario): sin uso desde `cutoff`, o cerradas
        # antes de `cutoff`. Una sesión vigente y usada recientemente NO se toca.
        counts["sessions"] = db.session.execute(
            delete(Session).where(
                or_(
                    and_(Session.revoked_at.is_not(None), Session.revoked_at < cutoff),
                    and_(Session.revoked_at.is_(None), Session.last_used_at < cutoff),
                )
            )
        ).rowcount

        # Un token de renovación vale 30 días: con más de 90 ya no sirve para nada,
        # ni siquiera para detectar su reutilización.
        counts["refresh_tokens"] = db.session.execute(
            delete(RefreshToken).where(RefreshToken.created_at < cutoff)
        ).rowcount

        # Códigos de un solo uso (solo guardan el hash del código).
        counts["password_reset_tokens"] = db.session.execute(
            delete(PasswordResetToken).where(PasswordResetToken.created_at < cutoff)
        ).rowcount
        counts["email_verification_tokens"] = db.session.execute(
            delete(EmailVerificationToken).where(EmailVerificationToken.created_at < cutoff)
        ).rowcount

        # Acciones de Tero (ADR-041): propuestas ya resueltas o vencidas hace más de 90 días.
        counts["tero_pending_actions"] = db.session.execute(
            delete(TeroPendingAction).where(TeroPendingAction.created_at < cutoff)
        ).rowcount

        # Una sola transacción: o se borra todo lo vencido o nada.
        db.session.commit()
        return counts
