# Localiza lo que se está reportando (domain/reports/repositories.py,
# ADR-032-content-reports-and-moderation.md §2).
#
# Un solo lugar que conoce las cuatro tablas posibles (posts, comentarios,
# mensajes, usuarios y reseñas de lugares), para no agregar un `find_by_id` a cada repositorio
# existente. NO decide la visibilidad: eso es del caso de uso, que ya conoce las
# guardias de ADR-022 y ADR-029.

from app.domain.reports import kinds
from app.domain.reports.repositories import ReportTargetResolver, ResolvedTarget
from app.extensions import db
from sqlalchemy import text

from app.infrastructure.persistence.models import Comment, Message, Post, User


def _profile_text(user):
    """Los campos de texto públicos de un perfil. Es lo que cualquiera ve de esa
    cuenta, no datos privados: sin correo, teléfono ni fecha de nacimiento."""
    parts = [user.username, user.name, user.bio, user.location, user.website]
    return " | ".join(part for part in parts if part)


class SQLAlchemyReportTargetResolver(ReportTargetResolver):
    def resolve(self, target_type, target_id):
        if target_type == kinds.TARGET_POST:
            post = db.session.get(Post, target_id)
            if post is None:
                return None
            return ResolvedTarget(
                target_type=target_type,
                target_id=str(post.id),
                owner_id=str(post.author_id),
                text=post.content or "",
                post=post,
            )

        if target_type == kinds.TARGET_COMMENT:
            comment = db.session.get(Comment, target_id)
            if comment is None:
                return None
            # `Comment` no tiene relación con su post: se busca por `post_id`.
            post = db.session.get(Post, comment.post_id)
            if post is None:
                return None
            return ResolvedTarget(
                target_type=target_type,
                target_id=str(comment.id),
                owner_id=str(comment.author_id),
                text=comment.content or "",
                post=post,
            )

        if target_type == kinds.TARGET_MESSAGE:
            message = db.session.get(Message, target_id)
            if message is None:
                return None
            return ResolvedTarget(
                target_type=target_type,
                target_id=str(message.id),
                owner_id=str(message.sender_id),
                text=message.content or "",
                recipient_id=str(message.recipient_id),
            )

        if target_type == kinds.TARGET_USER:
            user = db.session.get(User, target_id)
            if user is None:
                return None
            return ResolvedTarget(
                target_type=target_type,
                target_id=str(user.id),
                owner_id=str(user.id),
                text=_profile_text(user),
            )

        if target_type == kinds.TARGET_REVIEW:
            # Solo una reseña visible para el público: ni oculta por moderación ni de un
            # lugar que ya no es público. En esos casos «no existe» (404), igual que el
            # resto de objetivos que no se pueden ver.
            row = db.session.execute(
                text(
                    "SELECT r.id, r.user_id, r.rating, r.body FROM place_reviews r "
                    "JOIN places p ON p.id = r.place_id "
                    "JOIN place_categories c ON c.id = p.category_id "
                    "WHERE r.id = :id AND NOT r.is_hidden AND p.is_active "
                    "AND p.verification_status IN ('verified', 'unverified') AND c.is_active"
                ),
                {"id": str(target_id)},
            ).mappings().first()
            if row is None:
                return None
            return ResolvedTarget(
                target_type=target_type,
                target_id=str(row["id"]),
                owner_id=str(row["user_id"]),
                text=f"[{row['rating']}/5] {row['body'] or ''}".strip(),
            )

        return None
