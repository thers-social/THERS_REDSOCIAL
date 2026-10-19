# Adaptador SQLAlchemy del puerto `PostRepository` (domain/posts/repositories.py).
# Único punto del backend que traduce entre `posts` (PostgreSQL) y el resto
# de las capas -- domain/ y application/ no importan SQLAlchemy directamente
# (BACKEND_ARCHITECTURE.md §17), solo reciben el objeto `Post` ya resuelto.

from sqlalchemy import and_, delete as sa_delete, func, literal_column, or_, select, text, update

from sqlalchemy.sql.elements import Grouping

from app.domain.posts.repositories import PostRepository
from app.extensions import db
from app.infrastructure.persistence.repositories.place_cards import fetch_place_cards
from app.infrastructure.persistence.models import (
    Comment,
    Follow,
    Like,
    MediaAttachment,
    MutedTopic,
    Post,
    SavedPost,
    User,
    VideoAttachment,
)
from app.infrastructure.persistence.repositories.post_visibility_sql import (
    audience_ok as _audience_ok,
    not_blocked as _not_blocked,
    visible_to_viewer as _visible_to_viewer,
)


class SQLAlchemyPostRepository(PostRepository):
    def create(self, author_id, content, is_sensitive=False, place_id=None, audience="everyone"):
        post = Post(
            author_id=author_id, content=content, is_sensitive=is_sensitive, place_id=place_id,
            audience=audience,
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

    def list_recent(
        self, limit, viewer_id, muted_keywords=(), place_id=None, post_id=None, saved_by=None,
        author_id=None, explore=None, offset=0,
    ):
        # Traducción literal a SQL de domain/privacy/visibility.py
        # (can_view_content_of): el post entra en el feed si el autor no es
        # privado, O es el propio espectador, O el espectador tiene un follow
        # aceptado hacia él. Cualquier cambio de esa regla hay que hacerlo en
        # los dos lugares -- están deliberadamente nombrados uno en el otro.
        #
        # Va en el WHERE y no en Python a propósito: filtrar después del
        # LIMIT devolvería páginas cortas (ADR-022 §Decisión).
        # Las reglas de visibilidad (cuentas privadas, ADR-022; bloqueos en cualquiera de los dos
        # sentidos, ADR-029) viven en `post_visibility_sql.py`: las comparte con las tarjetas de una
        # publicación compartida por mensaje (ADR-047). Van en el WHERE y no en Python a propósito:
        # filtrar después del LIMIT devolvería páginas cortas.
        visible_to_viewer = _visible_to_viewer(viewer_id)
        not_blocked = _not_blocked(viewer_id)

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

        conditions = [visible_to_viewer, not_blocked, _audience_ok(viewer_id), sensitive_ok, topics_ok]

        # Solo las publicaciones de un lugar (ADR-040 fase 4d). Las reglas de visibilidad de
        # arriba aplican igual: el lugar no es una forma de saltárselas.
        if place_id is not None:
            conditions.append(Post.place_id == place_id)

        # Publicaciones de una sola persona (perfil ajeno). Las reglas de arriba aplican igual:
        # abrir un perfil no es una forma de saltarse cuentas privadas, bloqueos ni filtros.
        if author_id is not None:
            conditions.append(Post.author_id == author_id)

        # Explorar (ADR-050): publicaciones con foto o video de personas que quien mira NO sigue (ni
        # se ha pedido seguir) y que no son suyas, de los últimos 30 días. `explore` es
        # 'all' | 'images' | 'videos'. Las reglas de visibilidad de arriba aplican igual.
        popularity = None
        if explore is not None:
            has_image = (
                select(MediaAttachment.id).where(MediaAttachment.post_id == Post.id).exists()
            )
            has_video = (
                select(VideoAttachment.id).where(VideoAttachment.post_id == Post.id).exists()
            )
            kinds = {"images": has_image, "videos": has_video}
            conditions.append(kinds.get(explore) if explore in kinds else or_(has_image, has_video))
            conditions.append(Post.author_id != viewer_id)
            conditions.append(
                ~select(Follow.id)
                .where(Follow.follower_id == viewer_id, Follow.followed_id == Post.author_id)
                .exists()
            )
            conditions.append(Post.created_at >= func.now() - text("interval '30 days'"))
            likes = select(func.count(Like.id)).where(Like.post_id == Post.id).scalar_subquery()
            comments = (
                select(func.count(Comment.id)).where(Comment.post_id == Post.id).scalar_subquery()
            )
            popularity = likes + 2 * comments

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

        query = select(Post).join(User, User.id == Post.author_id)
        if saved_by is not None:
            # Guardadas (ADR-047): las de esta persona, las más recientes primero POR FECHA DE GUARDADO,
            # y solo las que sigue pudiendo ver (las demás reglas de arriba aplican igual).
            query = query.join(
                SavedPost, and_(SavedPost.post_id == Post.id, SavedPost.user_id == saved_by)
            ).order_by(SavedPost.created_at.desc())
        elif popularity is not None:
            query = query.order_by(popularity.desc(), Post.created_at.desc())
        else:
            query = query.order_by(Post.created_at.desc())
        return db.session.execute(
            query.where(*conditions).offset(offset).limit(limit)
        ).scalars().all()

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
