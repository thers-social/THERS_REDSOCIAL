# Adaptador SQLAlchemy del puerto `PostRepository` (domain/posts/repositories.py).
# Único punto del backend que traduce entre `posts` (PostgreSQL) y el resto
# de las capas -- domain/ y application/ no importan SQLAlchemy directamente
# (BACKEND_ARCHITECTURE.md §17), solo reciben el objeto `Post` ya resuelto.

from sqlalchemy import and_, delete as sa_delete, func, literal_column, or_, select, update

from sqlalchemy.sql.elements import Grouping

from app.domain.follows.follow_status import ACCEPTED
from app.domain.posts.repositories import PostRepository
from app.domain.restrictions.kinds import BLOCK
from app.extensions import db
from app.infrastructure.persistence.repositories.place_cards import fetch_place_cards
from app.infrastructure.persistence.models import (
    Follow,
    MutedTopic,
    Post,
    User,
    UserRestriction,
)


class SQLAlchemyPostRepository(PostRepository):
    def create(self, author_id, content, is_sensitive=False, place_id=None):
        post = Post(
            author_id=author_id, content=content, is_sensitive=is_sensitive, place_id=place_id
        )
        db.session.add(post)
        db.session.commit()
        # Refresh para traer created_at/id ya generados por PostgreSQL, y
        # accede a `post.author` para forzar la resolución del autor antes
        # de que la sesión se cierre (evita un DetachedInstanceError si el
        # presenter se llama fuera de este contexto).
        db.session.refresh(post)
        _ = post.author
        return post

    def place_cards(self, place_ids):
        return fetch_place_cards(place_ids)

    def list_recent(self, limit, viewer_id, muted_keywords=(), place_id=None, post_id=None):
        # Traducción literal a SQL de domain/privacy/visibility.py
        # (can_view_content_of): el post entra en el feed si el autor no es
        # privado, O es el propio espectador, O el espectador tiene un follow
        # aceptado hacia él. Cualquier cambio de esa regla hay que hacerlo en
        # los dos lugares -- están deliberadamente nombrados uno en el otro.
        #
        # Va en el WHERE y no en Python a propósito: filtrar después del
        # LIMIT devolvería páginas cortas (ADR-022 §Decisión).
        visible_to_viewer = or_(
            User.is_private.is_(False),
            Post.author_id == viewer_id,
            select(Follow.id)
            .where(
                Follow.follower_id == viewer_id,
                Follow.followed_id == Post.author_id,
                Follow.status == ACCEPTED,
            )
            .exists(),
        )

        # Un bloqueo en CUALQUIERA de los dos sentidos oculta el post
        # (ADR-029-blocked-and-restricted-accounts.md). También en el WHERE, por
        # el mismo motivo: filtrar después del LIMIT devolvería páginas cortas.
        not_blocked = ~(
            select(UserRestriction.id)
            .where(
                UserRestriction.kind == BLOCK,
                or_(
                    and_(
                        UserRestriction.owner_id == viewer_id,
                        UserRestriction.target_id == Post.author_id,
                    ),
                    and_(
                        UserRestriction.owner_id == Post.author_id,
                        UserRestriction.target_id == viewer_id,
                    ),
                ),
            )
            .exists()
        )

        # Preferencias de contenido (ADR-030-content-preferences.md). Mismas
        # reglas que el resto de filtros: en el WHERE, y su propio post nunca
        # se le oculta a quien lo escribió.
        #
        #   · Sensibles: solo si el espectador activó `hide_sensitive_content`.
        #     La preferencia se lee con una subconsulta escalar sobre `users`,
        #     así no hace falta traer al usuario ni cambiar la firma de
        #     `list_recent`.
        viewer_hides_sensitive = (
            select(User.hide_sensitive_content)
            .where(User.id == viewer_id)
            .scalar_subquery()
        )
        sensitive_ok = or_(
            Post.is_sensitive.is_(False),
            Post.author_id == viewer_id,
            viewer_hides_sensitive.is_(False),
        )

        #   · Temas silenciados: el post se oculta si contiene la etiqueta
        #     `#tema` COMPLETA (no `#temas`), sin distinguir mayúsculas. El
        #     patrón se arma en SQL a partir de cada fila de `muted_topics` del
        #     espectador; `topic` solo puede contener letras, dígitos y `_`
        #     (domain/moderation/topic_matching.py), así que no hay
        #     metacaracteres de regex que escapar.
        # `literal_column` y no un parámetro: son constantes del código (no
        # hay entrada de nadie), y evita que el driver tenga que inferir el tipo
        # de un argumento suelto de `concat`.
        #
        # Entre paréntesis (`Grouping`) a propósito: en PostgreSQL `||` y `~*`
        # tienen la misma precedencia y asocian a la izquierda, así que sin ellos
        # `a ~* 'x' || y` se lee `(a ~* 'x') || y` y falla por tipos.
        topic_pattern = Grouping(
            literal_column("'(^|[^[:alnum:]_])#'")
            + MutedTopic.topic
            + literal_column("'([^[:alnum:]_]|$)'")
        )
        has_muted_topic = (
            select(MutedTopic.id)
            .where(
                MutedTopic.user_id == viewer_id,
                Post.content.op("~*")(topic_pattern),
            )
            .exists()
        )
        topics_ok = or_(Post.author_id == viewer_id, ~has_muted_topic)

        conditions = [visible_to_viewer, not_blocked, sensitive_ok, topics_ok]

        # Solo las publicaciones de un lugar (ADR-040 fase 4d). Las reglas de visibilidad de
        # arriba aplican igual: el lugar no es una forma de saltárselas.
        if place_id is not None:
            conditions.append(Post.place_id == place_id)

        # Un solo post por id (Tero, ADR-041 `post_read`). Reutiliza TODAS las reglas de arriba
        # (cuentas privadas, bloqueos, contenido sensible, temas y términos silenciados): leer un
        # post por id no es una forma de saltárselas.
        if post_id is not None:
            conditions.append(Post.id == post_id)

        # Términos filtrados del espectador (ADR-024). Su propio post nunca se
        # le oculta: filtrar una palabra no debería hacer desaparecer lo que
        # uno mismo escribió.
        if muted_keywords:
            not_muted = and_(
                *[Post.content.not_ilike(f"%{term}%") for term in muted_keywords]
            )
            conditions.append(or_(Post.author_id == viewer_id, not_muted))

        return (
            db.session.execute(
                select(Post)
                .join(User, User.id == Post.author_id)
                .where(*conditions)
                .order_by(Post.created_at.desc())
                .limit(limit)
            )
            .scalars()
            .all()
        )

    def get_by_id(self, post_id):
        return db.session.get(Post, post_id)

    def delete(self, post_id, author_id):
        # `author_id` en el propio WHERE, no un chequeo aparte después de
        # leer la fila -- confirma existencia y pertenencia en la misma
        # sentencia (mismo principio que SQLAlchemyMessageRepository.delete,
        # ADR-014). Likes, comentarios y notificaciones asociados al post se
        # borran solos: sus FKs a `posts.id` ya están declaradas con
        # ON DELETE CASCADE (ADR-005/ADR-006/ADR-008), así que PostgreSQL se
        # encarga en la misma transacción -- no hace falta borrarlos a mano.
        result = db.session.execute(
            sa_delete(Post).where(Post.id == post_id, Post.author_id == author_id)
        )
        db.session.commit()
        return result.rowcount > 0

    def update_content(self, post_id, author_id, content):
        # Mismo WHERE que delete() -- existencia y pertenencia en una sola
        # sentencia, sin leer la fila para compararla después
        # (ADR-021-content-editing.md §Seguridad).
        #
        # `edited_at=func.now()` sin coalesce, a diferencia de
        # NotificationRepository.mark_as_read/mark_thread_as_read: ahí
        # coalesce existe para no renovar la marca en una segunda llamada
        # (idempotente por diseño), mientras que acá cada edición es un
        # evento nuevo y `edited_at` debe reflejar la última, no la primera.
        result = db.session.execute(
            update(Post)
            .where(Post.id == post_id, Post.author_id == author_id)
            .values(content=content, edited_at=func.now())
        )
        db.session.commit()
        if result.rowcount == 0:
            return None

        # Relee la fila ya actualizada en vez de devolver lo que se escribió:
        # `edited_at` lo generó PostgreSQL (now()), no Python. Mismo motivo
        # por el que create() hace refresh(). Accede a `post.author` para
        # resolver el autor antes de que la sesión se cierre.
        post = db.session.get(Post, post_id)
        _ = post.author
        return post
