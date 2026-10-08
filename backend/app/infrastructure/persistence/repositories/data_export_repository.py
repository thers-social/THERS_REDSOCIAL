# Adaptador SQLAlchemy del puerto `DataExportRepository`
# (domain/data_exports/repositories.py). Único punto que traduce entre las
# tablas del usuario y el dict que serializa el archivo
# (ADR-028-data-export.md).

from sqlalchemy import func, select, update
from sqlalchemy.orm import aliased, defer

from app.domain.data_exports.repositories import DataExportRepository
from app.extensions import db
from app.infrastructure.persistence.models import (
    Comment,
    DataExport,
    Follow,
    Like,
    Message,
    MutedKeyword,
    MutedTopic,
    Notification,
    Post,
    Session,
    User,
    UserRestriction,
)


def _iso(value):
    return value.isoformat() if value is not None else None


class SQLAlchemyDataExportRepository(DataExportRepository):
    def collect_user_data(self, user_id):
        user = db.session.get(User, user_id)

        profile = {
            "id": str(user.id),
            "name": user.name,
            "username": user.username,
            "email": user.email,
            "email_verified": user.email_verified,
            "phone": user.phone,
            "country_code": user.country_code,
            "birth_date": _iso(user.birth_date),
            "created_at": _iso(user.created_at),
            "privacy": {
                "is_private": user.is_private,
                "who_can_mention": user.who_can_mention,
                "who_can_message": user.who_can_message,
                "hide_offensive_comments": user.hide_offensive_comments,
                "show_activity_status": user.show_activity_status,
                "hide_sensitive_content": user.hide_sensitive_content,
            },
            "security": {
                "login_alerts_enabled": user.login_alerts_enabled,
                # Solo si está activo o no: el secreto TOTP nunca sale.
                "two_factor_enabled": user.two_factor_enabled,
            },
        }

        posts = [
            {
                "id": str(p.id),
                "content": p.content,
                "created_at": _iso(p.created_at),
                "edited": p.edited_at is not None,
            }
            for p in db.session.execute(
                select(Post).where(Post.author_id == user_id).order_by(Post.created_at)
            )
            .scalars()
            .unique()
        ]

        comments = [
            {
                "id": str(c.id),
                "post_id": str(c.post_id),
                "content": c.content,
                "created_at": _iso(c.created_at),
                "edited": c.edited_at is not None,
            }
            for c in db.session.execute(
                select(Comment)
                .where(Comment.author_id == user_id)
                .order_by(Comment.created_at)
            )
            .scalars()
            .unique()
        ]

        likes = [
            {"post_id": str(post_id), "created_at": _iso(created_at)}
            for post_id, created_at in db.session.execute(
                select(Like.post_id, Like.created_at)
                .where(Like.user_id == user_id)
                .order_by(Like.created_at)
            )
        ]

        followed = aliased(User)
        following = [
            {"username": username, "status": status, "created_at": _iso(created_at)}
            for username, status, created_at in db.session.execute(
                select(followed.username, Follow.status, Follow.created_at)
                .join(followed, followed.id == Follow.followed_id)
                .where(Follow.follower_id == user_id)
                .order_by(Follow.created_at)
            )
        ]

        follower = aliased(User)
        followers = [
            {"username": username, "status": status, "created_at": _iso(created_at)}
            for username, status, created_at in db.session.execute(
                select(follower.username, Follow.status, Follow.created_at)
                .join(follower, follower.id == Follow.follower_id)
                .where(Follow.followed_id == user_id)
                .order_by(Follow.created_at)
            )
        ]

        messages = []
        for m in (
            db.session.execute(
                select(Message)
                .where((Message.sender_id == user_id) | (Message.recipient_id == user_id))
                .order_by(Message.created_at)
            )
            .scalars()
            .unique()
        ):
            sent = m.sender_id == user_id
            other = m.recipient if sent else m.sender
            messages.append(
                {
                    "direction": "sent" if sent else "received",
                    "with_username": other.username,
                    "content": m.content,
                    "created_at": _iso(m.created_at),
                    "read": m.read_at is not None,
                    "edited": m.edited_at is not None,
                }
            )

        actor = aliased(User)
        notifications = [
            {
                "type": type_,
                "from_username": username,
                "post_id": str(post_id) if post_id else None,
                "created_at": _iso(created_at),
                "read": read_at is not None,
            }
            for type_, username, post_id, created_at, read_at in db.session.execute(
                select(
                    Notification.type,
                    actor.username,
                    Notification.post_id,
                    Notification.created_at,
                    Notification.read_at,
                )
                .join(actor, actor.id == Notification.actor_id)
                .where(Notification.recipient_id == user_id)
                .order_by(Notification.created_at)
            )
        ]

        muted_keywords = [
            {"keyword": keyword, "created_at": _iso(created_at)}
            for keyword, created_at in db.session.execute(
                select(MutedKeyword.keyword, MutedKeyword.created_at)
                .where(MutedKeyword.user_id == user_id)
                .order_by(MutedKeyword.created_at)
            )
        ]

        muted_topics = [
            {"topic": topic, "created_at": _iso(created_at)}
            for topic, created_at in db.session.execute(
                select(MutedTopic.topic, MutedTopic.created_at)
                .where(MutedTopic.user_id == user_id)
                .order_by(MutedTopic.created_at)
            )
        ]

        # Solo las que la persona puso (ADR-029): saber QUIÉN te bloqueó a ti no
        # es un dato tuyo, y entregarlo desharía el propósito del bloqueo.
        target = aliased(User)
        restrictions = [
            {"username": username, "kind": kind, "created_at": _iso(created_at)}
            for username, kind, created_at in db.session.execute(
                select(target.username, UserRestriction.kind, UserRestriction.created_at)
                .join(target, target.id == UserRestriction.target_id)
                .where(UserRestriction.owner_id == user_id)
                .order_by(UserRestriction.created_at)
            )
        ]

        # Sin `jti`: es el identificador que valida cada petición, y un archivo
        # descargable no debe contener nada que sirva para autenticar.
        sessions = [
            {
                "user_agent": user_agent,
                "ip_address": ip_address,
                "created_at": _iso(created_at),
                "last_used_at": _iso(last_used_at),
                "revoked": revoked_at is not None,
            }
            for user_agent, ip_address, created_at, last_used_at, revoked_at in (
                db.session.execute(
                    select(
                        Session.user_agent,
                        Session.ip_address,
                        Session.created_at,
                        Session.last_used_at,
                        Session.revoked_at,
                    )
                    .where(Session.user_id == user_id)
                    .order_by(Session.created_at)
                )
            )
        ]

        # THERS Places (ADR-040): lugares guardados y reportes de datos que la persona hizo.
        saved_places = [
            {"place": name, "slug": slug, "saved_at": _iso(saved_at)}
            for name, slug, saved_at in db.session.execute(
                db.text(
                    "SELECT p.name, p.slug, s.created_at FROM saved_places s "
                    "JOIN places p ON p.id = s.place_id WHERE s.user_id = :u "
                    "ORDER BY s.created_at"
                ),
                {"u": str(user_id)},
            )
        ]
        place_reports = [
            {
                "place": name,
                "reason": reason,
                "details": details,
                "status": status,
                "created_at": _iso(created_at),
            }
            for name, reason, details, status, created_at in db.session.execute(
                db.text(
                    "SELECT p.name, r.reason, r.details, r.status, r.created_at "
                    "FROM place_reports r JOIN places p ON p.id = r.place_id "
                    "WHERE r.reporter_id = :u ORDER BY r.created_at"
                ),
                {"u": str(user_id)},
            )
        ]

        return {
            "profile": profile,
            "posts": posts,
            "comments": comments,
            "likes": likes,
            "following": following,
            "followers": followers,
            "messages": messages,
            "notifications": notifications,
            "muted_keywords": muted_keywords,
            "muted_topics": muted_topics,
            "restrictions": restrictions,
            "sessions": sessions,
            "saved_places": saved_places,
            "place_reports": place_reports,
        }

    def create(self, user_id, file_name, content, expires_at):
        export = DataExport(
            user_id=user_id,
            file_name=file_name,
            size_bytes=len(content),
            content=content,
            expires_at=expires_at,
        )
        db.session.add(export)
        db.session.commit()
        db.session.refresh(export)
        return export

    def latest_created_at(self, user_id):
        return db.session.execute(
            select(func.max(DataExport.created_at)).where(DataExport.user_id == user_id)
        ).scalar_one_or_none()

    def discard_expired_content(self, user_id):
        db.session.execute(
            update(DataExport)
            .where(
                DataExport.user_id == user_id,
                DataExport.content.is_not(None),
                DataExport.expires_at <= func.now(),
            )
            .values(content=None)
        )
        db.session.commit()

    def list_for_user(self, user_id, limit):
        return (
            db.session.execute(
                select(DataExport)
                .options(defer(DataExport.content))
                .where(DataExport.user_id == user_id)
                .order_by(DataExport.created_at.desc())
                .limit(limit)
            )
            .scalars()
            .all()
        )

    def get_for_user(self, export_id, user_id):
        return db.session.execute(
            select(DataExport).where(
                DataExport.id == export_id, DataExport.user_id == user_id
            )
        ).scalar_one_or_none()

    def mark_downloaded(self, export_id):
        db.session.execute(
            update(DataExport)
            .where(DataExport.id == export_id)
            .values(
                downloaded_at=func.now(),
                download_count=DataExport.download_count + 1,
            )
        )
        db.session.commit()
