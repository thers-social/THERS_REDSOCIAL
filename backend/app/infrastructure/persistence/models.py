# Modelos de persistencia (SQLAlchemy). Ver docs/architecture/DATABASE_ARCHITECTURE.md
# §5 para el contrato de `users` — tipo de PK, tipo de `email` y timestamps
# alineados a la decisión de UUID + CITEXT + DEFAULT en PostgreSQL indicada
# por el Tech Lead Backend.
#
# Nota de capas (BACKEND_ARCHITECTURE.md §17): este módulo pertenece a
# infraestructura/persistencia, no a `domain/`. `domain/auth/auth_service.py`
# no debe importar SQLAlchemy ni este módulo directamente.

from sqlalchemy import CheckConstraint, Index, text
from sqlalchemy.dialects.postgresql import CITEXT, JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.types import UserDefinedType

from app.extensions import db


class User(db.Model):
    __tablename__ = "users"

    # UUID generado por PostgreSQL (DEFAULT gen_random_uuid(), función nativa
    # desde PostgreSQL 13 — no requiere la extensión pgcrypto/uuid-ossp). El
    # valor por defecto vive en la base de datos (server_default), no en Python,
    # para que cualquier INSERT (vía ORM o SQL directo) reciba un id válido.
    id = db.Column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )

    name = db.Column(db.String(120), nullable=False)

    # Columnas de perfil (ADR-002 — docs/architecture/ADR-002-user-profile-fields.md),
    # recolectadas por Register.jsx pero no persistidas hasta esta tarea.
    # `username` es case-sensitive a propósito (a diferencia de `email`): hoy
    # ningún flujo (login sigue siendo por email) requiere comparación
    # case-insensitive de username -- ver ADR-002 §3.
    username = db.Column(db.String(30), unique=True, nullable=False)

    # Nullable desde ADR-012-google-sign-in.md: Google no entrega teléfono ni
    # fecha de nacimiento -- una cuenta creada por "Continuar con Google" nace
    # sin estos tres (ver `profile_completed` más abajo). El registro
    # tradicional (`register_use_case.py`) sigue exigiéndolos siempre, a
    # nivel de route (`is_valid_phone`/`parse_birth_date`), así que para esas
    # cuentas nunca quedan en `NULL` en la práctica.
    phone = db.Column(db.String(20), nullable=True)
    country_code = db.Column(db.String(6), nullable=True)
    birth_date = db.Column(db.Date, nullable=True)

    # Soporta la regla de cooldown de cambio de username (ADR-003 —
    # docs/architecture/ADR-003-profile-update-contract.md §Evolución
    # futura, "Cambios de username": máx. 1 cambio cada 30 días). `NULL`
    # significa "nunca cambió su username" -- domain/auth/username_policy.py
    # trata ese caso como "cambio permitido". No se reutiliza `updated_at`
    # porque esa cambia con cualquier campo, no solo con `username`.
    username_changed_at = db.Column(db.DateTime(timezone=True), nullable=True)

    # Verificación de email (ADR-009-password-reset-and-email-verification.md).
    # DEFAULT false en el servidor -- toda cuenta existente antes de esta
    # migración queda sin verificar (no hay backfill que pueda "adivinar" que
    # un email histórico es válido). `email_verified` es la única columna que
    # POST /api/verify-email puede escribir; nunca se acepta desde ningún
    # body (mismo principio anti mass-assignment que el resto de `users`).
    email_verified = db.Column(
        db.Boolean, nullable=False, server_default=text("false")
    )

    # Onboarding con Google (ADR-012-google-sign-in.md §Decisión): una cuenta
    # nueva creada por "Continuar con Google" recibe un JWT válido de
    # inmediato (la identidad ya está autenticada), pero nace con
    # `phone`/`country_code`/`birth_date` en `NULL` y un `username`
    # provisorio -- `profile_completed=false` hasta que la persona los
    # complete vía `PATCH /api/users/me` (reutilizado, ADR-003, sin endpoint
    # nuevo). El registro tradicional los exige todos desde el inicio, así
    # que siempre nace en `true` (`DEFAULT true` a nivel de columna). Nunca
    # se vuelve a `false` una vez en `true`.
    profile_completed = db.Column(
        db.Boolean, nullable=False, server_default=text("true")
    )

    # Perfil público extendido y medios (ADR-015-profile-media.md). Todas
    # nullable: `NULL` = "la persona no lo definió" (nunca un texto vacío ni
    # un valor inventado). `avatar_path`/`cover_path` guardan la CLAVE del
    # objeto en el almacenamiento (p. ej. "avatars/<uuid>.webp"), no una URL:
    # la URL pública depende del entorno (disco local, Supabase, R2) y se
    # resuelve al presentar (application/media/media_url.py).
    bio = db.Column(db.String(160), nullable=True)
    location = db.Column(db.String(60), nullable=True)
    website = db.Column(db.String(100), nullable=True)
    avatar_path = db.Column(db.String(255), nullable=True)
    cover_path = db.Column(db.String(255), nullable=True)

    # CITEXT (case-insensitive text, extensión de PostgreSQL) en vez de VARCHAR:
    # el UNIQUE sobre email ignora mayúsculas/minúsculas a nivel de motor, sin
    # normalizar manualmente en la capa de aplicación. Requiere
    # `CREATE EXTENSION IF NOT EXISTS citext` (ver migración).
    email = db.Column(CITEXT, unique=True, nullable=False, index=True)

    # TEXT en vez de VARCHAR(255): el hash (scrypt vía werkzeug.security) no
    # tiene una longitud máxima fija que valga la pena restringir a nivel de
    # esquema.
    #
    # Nullable desde ADR-012-google-sign-in.md: una cuenta creada
    # exclusivamente vía "Continuar con Google" no tiene contraseña local --
    # `NULL` significa exactamente eso, nunca una contraseña vacía/falsa ni
    # un valor inventado (`"GOOGLE_USER"` u otro). `login_use_case.py` trata
    # `password_hash IS NULL` como credenciales inválidas (mismo mensaje
    # genérico que cualquier otro fallo de login, sin revelar que la cuenta
    # es Google-only). El flujo de recuperación de contraseña
    # (`forgot-password`/`verify-reset-code`/`reset-password`, ADR-010) deja
    # de ser solo "recuperación" para esta cuenta -- se reutiliza tal cual
    # para fijar la primera contraseña ("Set password"), sin cambios de
    # código: un `UPDATE password_hash` funciona igual si el valor previo
    # era `NULL`.
    password_hash = db.Column(db.Text, nullable=True)

    # Cuenta privada (ADR-022-private-accounts.md). `false` = comportamiento
    # histórico: cualquiera ve tus publicaciones. `true` = solo te ven quienes
    # tienen un follow en estado 'accepted' (Follow.status), más vos mismo.
    # NOT NULL con DEFAULT false -- ninguna cuenta existente se vuelve privada
    # por efecto de la migración.
    is_private = db.Column(db.Boolean, nullable=False, server_default=text("false"))

    # Resto de preferencias de privacidad
    # (ADR-023-mentions.md, ADR-024-content-filters-and-privacy-preferences.md).
    # Todas con DEFAULT que preserva el comportamiento previo, salvo
    # `show_activity_status`: nace en true porque hasta ADR-024 no existía
    # ningún dato de presencia, así que no expone nada retroactivo
    # (`last_seen_at` arranca en NULL para todo el mundo).
    #
    # Los tres VARCHAR(20) son discriminadores validados en la aplicación
    # (domain/privacy/audience.py), no ENUM de PostgreSQL -- mismo criterio que
    # Notification.type (ADR-008) y Follow.status (ADR-022).
    who_can_mention = db.Column(
        db.String(20), nullable=False, server_default=text("'everyone'")
    )
    who_can_message = db.Column(
        db.String(20), nullable=False, server_default=text("'everyone'")
    )
    # El interruptor es del dueño de la publicación y filtra los comentarios de
    # SUS cápsulas contra la lista del sistema (domain/moderation/
    # offensive_words.py) -- no contra términos propios, que son
    # `muted_keywords` y se aplican a lo que uno lee (ADR-024 §Decisión).
    hide_offensive_comments = db.Column(
        db.Boolean, nullable=False, server_default=text("false")
    )
    show_activity_status = db.Column(
        db.Boolean, nullable=False, server_default=text("true")
    )
    # NULL = nunca se registró actividad, o está oculta. Nunca cruza la
    # frontera HTTP si `show_activity_status` es false (ADR-024 §Seguridad).
    last_seen_at = db.Column(db.DateTime(timezone=True), nullable=True)

    # Preferencias de contenido y feed (ADR-030-content-preferences.md). Si es
    # true, el feed de esta persona omite las publicaciones marcadas como
    # sensibles por su autor (`Post.is_sensitive`). Nace en false: ocultar por
    # defecto cambiaría lo que ve todo el mundo sin que nadie lo pida.
    hide_sensitive_content = db.Column(
        db.Boolean, nullable=False, server_default=text("false")
    )

    # Alertas de inicio de sesión (ADR-025-session-registry.md). Nace en `true`
    # -- una alerta de seguridad que hay que descubrir y encender no protege a
    # nadie. Sin RESEND_API_KEY el envío es un no-op registrado por log, igual
    # que el resto de correos del proyecto.
    login_alerts_enabled = db.Column(
        db.Boolean, nullable=False, server_default=text("true")
    )

    # Autenticación en dos pasos con TOTP (ADR-026-two-factor-authentication.md).
    #
    # `totp_secret` se guarda **recuperable, no hasheado**, y es inevitable:
    # verificar un código TOTP exige recalcularlo a partir del secreto. Es la
    # diferencia estructural con los OTP de ADR-010/ADR-011, que sí se hashean
    # porque el código viaja una vez y solo hay que compararlo. La consecuencia
    # (una fuga de esta columna permite generar códigos válidos) está en
    # ADR-026 §Riesgos.
    #
    # `two_factor_enabled` está separada del secreto a propósito: durante el
    # alta existe un secreto todavía NO confirmado (la persona escaneó el QR
    # pero no probó que su app genera códigos correctos). Sin esa separación,
    # escanear y abandonar dejaría la cuenta exigiendo un código que nadie
    # puede producir.
    totp_secret = db.Column(db.Text, nullable=True)
    two_factor_enabled = db.Column(
        db.Boolean, nullable=False, server_default=text("false")
    )

    # Aceptación de los términos de uso (ADR-032 §5). NULL = nunca aceptó: es el
    # caso de TODAS las cuentas anteriores a esta columna, y se tratan como no
    # aceptadas. `terms_version` es la versión que aceptó, no la vigente: así se
    # sabe a quién volver a preguntarle cuando los términos cambian.
    terms_accepted_at = db.Column(db.DateTime(timezone=True), nullable=True)
    terms_version = db.Column(db.String(32), nullable=True)

    # Moderación de la plataforma (ADR-032 fase 2). `is_moderator` solo se asigna
    # por línea de comandos (`flask set-moderator`), nunca por la API. Una cuenta
    # suspendida no puede iniciar sesión y ve `suspension_reason`.
    is_moderator = db.Column(db.Boolean, nullable=False, server_default=text("false"))
    # Rol separado de moderación de contenido (ADR-044 §2.5); NULL = ninguno. Solo por línea de
    # comandos. `is_moderator` equivale a `reviewer`.
    moderation_role = db.Column(db.String(16), nullable=True)
    suspended_at = db.Column(db.DateTime(timezone=True), nullable=True)
    suspension_reason = db.Column(db.String(500), nullable=True)

    # DEFAULT now() en la base de datos. `updated_at` se mantiene actualizado
    # por un trigger de PostgreSQL (set_updated_at, ver migración), no por
    # SQLAlchemy — así funciona igual para updates hechos vía ORM o SQL directo.
    created_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    updated_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    def __repr__(self):
        return f"<User id={self.id} email={self.email!r}>"


class Post(db.Model):
    __tablename__ = "posts"

    # Primera entidad del alcance objetivo del producto en pasar a
    # ratificada (ADR-004-posts-minimal-model.md) -- modelo deliberadamente
    # mínimo: solo texto, sin mood/imagen/hashtags/ubicación/likes/comentarios
    # (cada uno queda para su propio ADR, ver DATABASE_ARCHITECTURE.md §4.B).

    id = db.Column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )

    # ON DELETE CASCADE: placeholder razonable dado que borrado de cuenta
    # tampoco existe todavía como funcionalidad (ADR-004 §Riesgos) -- revisar
    # cuando esa funcionalidad se ratifique.
    author_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Sin límite de longitud a nivel de esquema -- la validación de negocio
    # (MAX_CONTENT_LENGTH) vive en domain/posts/validators.py, no aquí.
    content = db.Column(db.Text, nullable=False)

    created_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    updated_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    # NULL = nunca editado (ADR-021-content-editing.md). Se expone como el
    # booleano `edited`, nunca como timestamp crudo -- mismo criterio que
    # Message.read_at/Notification.read_at. No se infiere de `updated_at`:
    # ese nace igual a `created_at` por su server_default (ADR-021
    # §Opciones consideradas).
    edited_at = db.Column(db.DateTime(timezone=True), nullable=True)

    # Marcada como sensible por SU AUTOR al publicar (ADR-030). No es una
    # clasificación automática ni una decisión de moderación: es lo que quien
    # escribe declara. NOT NULL con DEFAULT false -- ninguna publicación
    # existente pasa a ser sensible por efecto de la migración.
    is_sensitive = db.Column(db.Boolean, nullable=False, server_default=text("false"))

    # Lugar al que se asocia la publicación (ADR-040 fase 4d). NULL = sin lugar. SET NULL: si el
    # lugar desaparece del catálogo la publicación se conserva.
    place_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("places.id", ondelete="SET NULL"),
        nullable=True,
    )

    # lazy="joined": listar posts siempre necesita el autor (to_public_post),
    # un JOIN evita el N+1 que tendría cada post resolviendo su autor por
    # separado.
    author = db.relationship("User", lazy="joined")

    # Imágenes adjuntas (ADR-039). `selectin`: una sola consulta extra para TODA la
    # página de posts, no una por post. El borrado lo hace PostgreSQL con
    # ON DELETE CASCADE; la relación es de solo lectura.
    images = db.relationship(
        "MediaAttachment",
        primaryjoin="Post.id == MediaAttachment.post_id",
        order_by="MediaAttachment.position",
        lazy="selectin",
        viewonly=True,
    )

    def __repr__(self):
        return f"<Post id={self.id} author_id={self.author_id}>"


class Like(db.Model):
    __tablename__ = "likes"

    # Segunda entidad del alcance objetivo del producto en pasar a
    # ratificada (ADR-005-likes-minimal-model.md) -- caso binario like/no-like,
    # sin tipos de reacción (esa forma general sigue como candidata
    # `reactions` sin ratificar, DATABASE_ARCHITECTURE.md §4.B).

    id = db.Column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )

    # ON DELETE CASCADE en ambas FKs: si se borra el post o el usuario, sus
    # likes se borran con él (mismo placeholder que ADR-004 ya aceptó para
    # posts.author_id -- borrado de cuenta/post no existe todavía).
    post_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("posts.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )

    created_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    # Sin `updated_at`: un like no se edita in place, solo se crea o se
    # borra (ADR-005 §Modelo de datos).

    __table_args__ = (
        db.UniqueConstraint("post_id", "user_id", name="uq_likes_post_user"),
    )

    def __repr__(self):
        return f"<Like post_id={self.post_id} user_id={self.user_id}>"


class Comment(db.Model):
    __tablename__ = "comments"

    # Tercera entidad del alcance objetivo del producto en pasar a
    # ratificada (ADR-006-comments-minimal-model.md) -- comentario plano
    # sobre un post, sin hilos de respuestas (`parent_comment_id` queda
    # fuera, ver ADR-006 §No objetivos).

    id = db.Column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )

    # ON DELETE CASCADE en ambas FKs: si se borra el post o el usuario, sus
    # comentarios se borran con él (mismo placeholder que ADR-004/ADR-005 ya
    # aceptaron -- borrado de cuenta/post no existe todavía).
    post_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("posts.id", ondelete="CASCADE"),
        nullable=False,
    )
    author_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Sin límite de longitud a nivel de esquema -- la validación de negocio
    # (MAX_CONTENT_LENGTH) vive en domain/comments/validators.py, no aquí.
    content = db.Column(db.Text, nullable=False)

    created_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    updated_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    # NULL = nunca editado (ADR-021-content-editing.md), mismo criterio que
    # Post.edited_at.
    edited_at = db.Column(db.DateTime(timezone=True), nullable=True)

    # lazy="joined": listar comentarios siempre necesita el autor (mismo
    # motivo que Post.author) -- evita el N+1 de resolverlo por separado.
    author = db.relationship("User", lazy="joined")

    def __repr__(self):
        return f"<Comment id={self.id} post_id={self.post_id} author_id={self.author_id}>"


class Follow(db.Model):
    __tablename__ = "follows"

    # Cuarta entidad del alcance objetivo del producto en pasar a ratificada
    # (ADR-007-follows-minimal-model.md) -- primera relación auto-referencial
    # (users<->users) del esquema.

    id = db.Column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )

    # ON DELETE CASCADE en ambas FKs: mismo placeholder que el resto de
    # entidades (borrado de cuenta no existe todavía como funcionalidad).
    follower_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    followed_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Estado del follow (ADR-022-private-accounts.md). 'accepted' = relación
    # efectiva; 'pending' = solicitud sin responder, solo alcanzable hacia una
    # cuenta con `is_private = true`. Antes de ADR-022 un follow era binario
    # (la fila existía o no), así que el DEFAULT 'accepted' hace de backfill:
    # todo follow previo se hizo hacia una cuenta pública.
    #
    # VARCHAR(20) validado en la aplicación (domain/follows/follow_status.py),
    # no ENUM de PostgreSQL -- mismo criterio que Notification.type (ADR-008).
    #
    # Ojo: la UNIQUE sigue siendo (follower_id, followed_id) sin `status`, así
    # que una misma pareja nunca puede tener a la vez una solicitud pendiente y
    # un follow aceptado -- son dos estados de la misma fila, no dos filas.
    status = db.Column(db.String(20), nullable=False, server_default=text("'accepted'"))

    created_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    # Sin `updated_at`: seguir a alguien no se edita in place, solo se crea
    # o se borra (mismo criterio que Like, ADR-005 §Modelo de datos).

    __table_args__ = (
        db.UniqueConstraint(
            "follower_id", "followed_id", name="uq_follows_follower_followed"
        ),
        db.CheckConstraint(
            "follower_id <> followed_id", name="ck_follows_no_self_follow"
        ),
    )

    def __repr__(self):
        return f"<Follow follower_id={self.follower_id} followed_id={self.followed_id}>"


class Notification(db.Model):
    __tablename__ = "notifications"

    # Sexta entidad del alcance objetivo del producto en pasar a ratificada
    # (ADR-008-notifications-minimal-model.md) -- discriminador de tipo
    # único (`type`), no una tabla por tipo de evento (DATABASE_ARCHITECTURE.md
    # §4.B › Notificaciones: "una entidad `notifications` con discriminador
    # de tipo -- no una tabla por tipo"). Cubre los tres eventos que el
    # backend ya sabe generar: 'like', 'comment', 'follow'.

    id = db.Column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )

    # ON DELETE CASCADE en ambas FKs a `users`: mismo placeholder que el
    # resto de entidades (borrado de cuenta no existe todavía como
    # funcionalidad).
    recipient_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    # Nulo solo en `place_claim_decided` (ADR-040 fase 12): el aviso no dice qué cuenta de
    # moderación decidió (lo exige un CHECK).
    actor_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
    )

    # VARCHAR corto en vez de un ENUM de PostgreSQL -- agregar un tipo nuevo
    # (p. ej. 'mention' el día que exista) no debe requerir un ALTER TYPE;
    # el conjunto válido ('like'/'comment'/'follow') se valida en la capa de
    # aplicación, no en el esquema (mismo criterio ya aceptado para
    # `content` de posts/comments: la forma se valida en domain/, no con un
    # CHECK).
    type = db.Column(db.String(40), nullable=False)

    # Fase 12 (ADR-040): avisos de Places. `object_id` es la reserva, cotización, plan, reclamo
    # o reseña según `type` (sin FK: apunta a tablas distintas); `detail` es el estado
    # («confirmed», «accepted»...). Nunca llevan texto libre de nadie.
    place_id = db.Column(
        PG_UUID(as_uuid=True), db.ForeignKey("places.id", ondelete="CASCADE"), nullable=True
    )
    object_id = db.Column(PG_UUID(as_uuid=True), nullable=True)
    detail = db.Column(db.String(20), nullable=True)

    # Nullable: solo 'like'/'comment' tienen un post de origen -- 'follow'
    # no tiene ningún post asociado, viaja como NULL (ADR-008 §Modelo de
    # datos). ON DELETE CASCADE: si el post se borra, sus notificaciones
    # asociadas se borran con él (no tendría sentido notificar sobre un post
    # que ya no existe).
    post_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("posts.id", ondelete="CASCADE"),
        nullable=True,
    )

    # NULL significa "no leída" -- se usa como el propio booleano en vez de
    # una columna `read` separada, para poder ordenar/filtrar por "hace
    # cuánto se leyó" en el futuro sin migrar de nuevo (mismo espíritu que
    # `username_changed_at`, aunque ese caso es de otra entidad). Nunca
    # cruza la frontera HTTP como timestamp -- la API expone `read` como
    # booleano (`API_CONTRACT.md` §5, mismo criterio que
    # `username_changed_at` nunca se expone tal cual).
    read_at = db.Column(db.DateTime(timezone=True), nullable=True)

    created_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    # Sin `updated_at`: una notificación no se edita in place más allá de
    # marcarse como leída (`read_at`), mismo criterio que Like/Follow no
    # llevan `updated_at` (ADR-005/ADR-007 §Modelo de datos).

    # lazy="joined": listar notificaciones siempre necesita el actor (mismo
    # motivo que Post.author/Comment.author) -- evita el N+1 de resolverlo
    # por separado. `recipient` no se declara como relationship -- ningún
    # caso de uso necesita navegar de la notificación a su destinatario
    # completo, solo compara su id (siempre ya conocido: es quien pregunta).
    actor = db.relationship("User", foreign_keys=[actor_id], lazy="joined")
    place = db.relationship("Place", foreign_keys=[place_id], lazy="joined")

    __table_args__ = (
        db.Index("ix_notifications_recipient_id_created_at", "recipient_id", "created_at"),
    )

    def __repr__(self):
        return f"<Notification recipient_id={self.recipient_id} type={self.type!r}>"


class Message(db.Model):
    __tablename__ = "messages"

    # Décima entidad del alcance objetivo del producto en pasar a
    # ratificada (ADR-013-messages-minimal-model.md) -- mensaje directo
    # entre dos usuarios reales, sin tabla `conversations`/`conversation_
    # participants`: una "conversación" es una vista derivada de todos los
    # mensajes entre dos usuarios, no una fila propia (ADR-013 §Opciones
    # consideradas).

    id = db.Column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )

    # ON DELETE CASCADE en ambas FKs: mismo placeholder que el resto de
    # entidades (borrado de cuenta no existe todavía como funcionalidad).
    sender_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    recipient_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Sin límite de longitud a nivel de esquema -- la validación de negocio
    # (MAX_CONTENT_LENGTH) vive en domain/messages/validators.py, mismo
    # criterio que posts/comments.
    content = db.Column(db.Text, nullable=False)

    # NULL = no leído. Mismo criterio que Notification.read_at (ADR-008):
    # nunca cruza la frontera HTTP como timestamp crudo, la API expone
    # "read" como booleano.
    read_at = db.Column(db.DateTime(timezone=True), nullable=True)

    created_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    # NULL = nunca editado (ADR-021-content-editing.md). Un mensaje sí se
    # edita in place desde ADR-021 -- lo que sigue sin tener, a diferencia de
    # Post/Comment, es `updated_at`: no hace falta un timestamp de "última
    # escritura" genérico cuando las dos escrituras posibles (marcar leído,
    # editar) ya tienen su propia columna. Se expone como el booleano
    # `edited`, nunca como timestamp crudo, igual que `read_at`.
    edited_at = db.Column(db.DateTime(timezone=True), nullable=True)

    # lazy="joined" en ambos extremos: listar conversaciones siempre
    # necesita identificar "la otra persona" -- evita el N+1 de resolverla
    # por separado (mismo motivo que Post.author/Comment.author).
    # Identificador que elige QUIEN ENVÍA para que reintentar un envío que falló a
    # medias no cree el mensaje dos veces (ADR-035-chat-sync.md). NULL en los
    # mensajes de clientes que no lo mandan. Único por remitente, no global: dos
    # personas pueden elegir el mismo valor sin chocar.
    client_id = db.Column(db.String(64), nullable=True)

    # Lugar compartido por chat (ADR-040 fase 4c). NULL = mensaje normal. SET NULL: si el
    # lugar desaparece del catálogo el mensaje se conserva (la tarjeta pasa a "no disponible").
    place_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("places.id", ondelete="SET NULL"),
        nullable=True,
    )

    sender = db.relationship("User", foreign_keys=[sender_id], lazy="joined")
    recipient = db.relationship("User", foreign_keys=[recipient_id], lazy="joined")

    # Imagen adjunta (ADR-039); misma estrategia de carga que `Post.images`.
    images = db.relationship(
        "MediaAttachment",
        primaryjoin="Message.id == MediaAttachment.message_id",
        order_by="MediaAttachment.position",
        lazy="selectin",
        viewonly=True,
    )

    __table_args__ = (
        # Sin UNIQUE: dos mensajes entre las mismas dos personas son eventos
        # legítimos e independientes, no un duplicado a impedir (mismo
        # criterio que `notifications`, ADR-008 §Modelo de datos).
        db.CheckConstraint(
            "sender_id <> recipient_id", name="ck_messages_no_self_message"
        ),
        # El hilo entre A y B se busca con
        # (sender_id=A AND recipient_id=B) OR (sender_id=B AND recipient_id=A),
        # ordenado por created_at -- ninguna columna única cubre ese acceso,
        # así que hacen falta ambos índices compuestos para que PostgreSQL
        # resuelva el OR sin escanear la tabla completa (ADR-013 §Índices).
        db.Index(
            "ix_messages_sender_recipient_created",
            "sender_id", "recipient_id", "created_at",
        ),
        db.Index(
            "ix_messages_recipient_sender_created",
            "recipient_id", "sender_id", "created_at",
        ),
        # Idempotencia del envío (ADR-035): a lo sumo un mensaje por
        # (remitente, client_id). Parcial: los mensajes sin client_id no compiten.
        db.Index(
            "uq_messages_sender_client_id",
            "sender_id", "client_id",
            unique=True,
            postgresql_where=text("client_id IS NOT NULL"),
        ),
    )

    def __repr__(self):
        return f"<Message sender_id={self.sender_id} recipient_id={self.recipient_id}>"


class MediaAttachment(db.Model):
    __tablename__ = "media_attachments"

    # Imagen adjunta a una publicación, un mensaje o una reseña de lugar (ADR-039,
    # ADR-040). Una sola tabla para los tres casos: cada fila pertenece a EXACTAMENTE uno (CHECK). El
    # archivo vive en el almacenamiento de medios; aquí solo su clave.
    id = db.Column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )

    # Quién la subió. Permite borrar sus archivos al eliminar la cuenta sin
    # recorrer posts y mensajes (ADR-031). ON DELETE CASCADE como el resto.
    owner_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    post_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("posts.id", ondelete="CASCADE"),
        nullable=True,
    )
    message_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("messages.id", ondelete="CASCADE"),
        nullable=True,
    )
    # Foto de una reseña de lugar (ADR-040 fase 4b).
    review_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("place_reviews.id", ondelete="CASCADE"),
        nullable=True,
    )

    # Nombre de objeto aleatorio e impredecible (`posts/<uuid4>.webp`). Único.
    storage_key = db.Column(db.Text, nullable=False, unique=True)
    width = db.Column(db.Integer, nullable=False)
    height = db.Column(db.Integer, nullable=False)
    # Orden dentro de la publicación (0 = primera).
    position = db.Column(db.SmallInteger, nullable=False, server_default=text("0"))

    created_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    # Moderación (ADR-044). El valor por defecto de la BASE es 'pending': una fila que no dice su
    # estado no se publica (falla cerrado). La aplicación lo fija siempre de forma explícita
    # (`content_moderation.initial_status`). Las filas anteriores a la migración son 'approved'.
    moderation_status = db.Column(
        db.String(10), nullable=False, server_default=text("'pending'")
    )
    # `auto` (motor de políticas) o el id de la persona que decidió.
    moderation_decided_by = db.Column(db.String(40), nullable=True)
    moderation_decided_at = db.Column(db.DateTime(timezone=True), nullable=True)

    __table_args__ = (
        db.CheckConstraint(
            "moderation_status IN ('pending', 'approved', 'held', 'rejected')",
            name="ck_media_attachments_moderation_status",
        ),
        db.Index("ix_media_attachments_moderation_status", "moderation_status"),
        db.CheckConstraint(
            "((post_id IS NOT NULL)::int + (message_id IS NOT NULL)::int "
            "+ (review_id IS NOT NULL)::int) = 1",
            name="ck_media_attachments_one_parent",
        ),
        db.Index("ix_media_attachments_review_id", "review_id"),
        db.Index("ix_media_attachments_post_id", "post_id"),
        db.Index("ix_media_attachments_message_id", "message_id"),
        db.Index("ix_media_attachments_owner_id", "owner_id"),
    )

    def __repr__(self):
        return f"<MediaAttachment id={self.id} key={self.storage_key}>"


class PasswordResetToken(db.Model):
    __tablename__ = "password_reset_tokens"

    # Séptima entidad del alcance objetivo del producto en pasar a
    # ratificada (ADR-009-password-reset-and-email-verification.md),
    # rediseñada en ADR-010-password-reset-otp-flow.md: pasa de un enlace
    # con token en la URL a un código OTP de 6 dígitos. Una sola fila cubre
    # las tres etapas del ciclo de vida (creada -> verificada -> usada) --
    # no hay una tabla separada por etapa (ADR-010 §Decisión).

    id = db.Column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )

    user_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Hash del código OTP de 6 dígitos -- con `werkzeug.security.generate_password_hash`
    # (scrypt, domain/auth/auth_service.hash_password), NO con el SHA-256
    # rápido de `token_generator.hash_token()`: un código de solo 10^6
    # combinaciones necesita un hash lento para que una fuga de esta tabla
    # no permita fuerza bruta offline instantánea (ADR-010 §Seguridad). TEXT
    # porque el formato de salida de scrypt (algoritmo$parámetros$salt$hash)
    # no tiene una longitud fija corta como el SHA-256 hexadecimal anterior.
    code_hash = db.Column(db.Text, nullable=False)

    # Cuántas veces se probó un código incorrecto contra esta solicitud
    # (ADR-010 §Seguridad) -- alcanzar PASSWORD_RESET_MAX_ATTEMPTS
    # (domain/auth/token_policy.py) vuelve la solicitud inutilizable sin
    # borrarla ni revelarlo distinto de un código simplemente incorrecto.
    attempts = db.Column(db.Integer, nullable=False, server_default=text("0"))

    # Vigencia del código OTP en sí (10 minutos desde su creación).
    expires_at = db.Column(db.DateTime(timezone=True), nullable=False)

    # NULL = el código todavía no se verificó correctamente. Se fija una
    # sola vez, junto con la autorización temporal de abajo (mark_verified).
    verified_at = db.Column(db.DateTime(timezone=True), nullable=True)

    # Autorización temporal emitida tras verificar el código -- el token
    # opaco que el Frontend usa en POST /api/reset-password sin tener que
    # reintroducir el OTP. SHA-256 (token_generator.hash_token()): a
    # diferencia del OTP, este token sí tiene 256 bits de entropía propios,
    # el mismo criterio que ya usaba el token de enlace de ADR-009.
    reset_authorization_hash = db.Column(db.String(64), nullable=True)
    reset_authorization_expires_at = db.Column(db.DateTime(timezone=True), nullable=True)

    # NULL = la contraseña todavía no se cambió con esta solicitud. Se fija
    # una sola vez, al completar POST /api/reset-password -- nunca se
    # revierte a NULL.
    used_at = db.Column(db.DateTime(timezone=True), nullable=True)

    created_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    __table_args__ = (
        db.Index("ix_password_reset_tokens_user_id_created_at", "user_id", "created_at"),
        db.Index(
            "ix_password_reset_tokens_reset_authorization_hash", "reset_authorization_hash"
        ),
        # Único índice parcial del esquema: a lo sumo una solicitud sin usar
        # por usuario en todo momento (ADR-010 §Opciones consideradas) --
        # última línea de defensa contra la condición de carrera de dos
        # "Reenviar código" simultáneos (ver
        # infrastructure/persistence/repositories/password_reset_repository.py
        # para el manejo de la excepción que esto puede producir).
        db.Index(
            "uq_password_reset_tokens_active_user",
            "user_id",
            unique=True,
            postgresql_where=text("used_at IS NULL"),
        ),
    )

    def __repr__(self):
        return f"<PasswordResetToken user_id={self.user_id}>"


class EmailVerificationToken(db.Model):
    __tablename__ = "email_verification_tokens"

    # Octava entidad del alcance objetivo del producto en pasar a ratificada
    # (ADR-009-password-reset-and-email-verification.md), reconstruida por
    # ADR-011-mandatory-email-verification.md: pasa de un enlace con token
    # de 256 bits a un código OTP de 6 dígitos, mismo patrón que
    # PasswordResetToken (ADR-010-password-reset-otp-flow.md) -- sin las
    # columnas de autorización temporal, que ahí no hacen falta: verificar
    # el email es de una sola etapa (el propio acierto ya marca
    # `email_verified = true`, no hay una acción sensible posterior que
    # proteger con un paso extra).

    id = db.Column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )

    user_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Hash scrypt del código de 6 dígitos (domain/auth/auth_service.hash_password)
    # -- no SHA-256: mismo motivo que PasswordResetToken.code_hash (ADR-010
    # §Opciones consideradas), un código de solo 10^6 combinaciones necesita
    # un hash lento para que una fuga de esta tabla no permita fuerza bruta
    # offline instantánea.
    code_hash = db.Column(db.Text, nullable=False)

    # Intentos de verificación fallidos contra este código (ADR-011 §Seguridad).
    attempts = db.Column(db.Integer, nullable=False, server_default=text("0"))

    expires_at = db.Column(db.DateTime(timezone=True), nullable=False)

    used_at = db.Column(db.DateTime(timezone=True), nullable=True)

    created_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    __table_args__ = (
        db.Index("ix_email_verification_tokens_user_id_created_at", "user_id", "created_at"),
        # Único índice parcial de esta entidad (mismo patrón que
        # PasswordResetToken, ADR-010 §Opciones consideradas): a lo sumo un
        # código activo por usuario, defensa de última línea contra dos
        # "Reenviar código" simultáneos.
        db.Index(
            "uq_email_verification_tokens_active_user",
            "user_id",
            unique=True,
            postgresql_where=text("used_at IS NULL"),
        ),
    )

    def __repr__(self):
        return f"<EmailVerificationToken user_id={self.user_id}>"


class UserIdentity(db.Model):
    __tablename__ = "user_identities"

    # Novena entidad del alcance objetivo del producto en pasar a ratificada
    # (ADR-012-google-sign-in.md). Vincula una identidad de un proveedor
    # externo (hoy solo "google") a un usuario de THERS -- tabla separada
    # de `users`, no columnas `google_sub`/`auth_provider` sueltas ahí, para
    # que agregar Apple/Microsoft más adelante sea una fila nueva con otro
    # `provider`, no una migración de esquema de `users` (§Opciones
    # consideradas del ADR). Un usuario puede tener cero, una, o varias
    # identidades vinculadas (p. ej. password + Google al mismo tiempo,
    # FASE 9 de la tarea origen -- account linking).

    id = db.Column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )

    user_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )

    # String libre, no ENUM de PostgreSQL -- mismo criterio que
    # `notifications.type` (ADR-008-notifications-minimal-model.md):
    # discriminador validado en la aplicación (domain/auth/google_identity.py
    # y quien lo llame), no a nivel de motor.
    provider = db.Column(db.String(20), nullable=False)

    # El claim `sub` del ID Token de Google (identificador estable de la
    # cuenta, FASE 6 de la tarea origen) -- nunca el email, que en teoría
    # podría cambiar sin que la cuenta de Google deje de ser la misma.
    provider_subject = db.Column(db.Text, nullable=False)

    created_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    __table_args__ = (
        # Garantiza a nivel de motor que la misma identidad externa
        # (`provider`, `provider_subject`) nunca termine vinculada a dos
        # usuarios de THERS a la vez -- defensa de última línea contra la
        # condición de carrera de dos requests simultáneas de
        # `POST /api/auth/google` para una cuenta de Google que todavía no
        # existía en THERS (ADR-012 §Seguridad).
        db.Index(
            "uq_user_identities_provider_subject",
            "provider",
            "provider_subject",
            unique=True,
        ),
        db.Index("ix_user_identities_user_id", "user_id"),
    )

    def __repr__(self):
        return f"<UserIdentity provider={self.provider!r} user_id={self.user_id}>"


class Mention(db.Model):
    __tablename__ = "mentions"

    # Undécima entidad del alcance objetivo del producto en pasar a ratificada
    # (ADR-023-mentions.md) -- resuelve la candidata "Menciones"
    # (DATABASE_ARCHITECTURE.md §4.B › Notificaciones).
    #
    # Una fila = "esta persona fue mencionada en este post O en este
    # comentario". No hay dos tablas (`post_mentions`/`comment_mentions`):
    # es el mismo hecho con dos targets posibles, resuelto con dos FKs
    # nullable y una CHECK que obliga a exactamente una (ADR-023 §Opciones
    # consideradas).

    id = db.Column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )

    mentioned_user_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Quién escribió la mención. Redundante con posts.author_id/
    # comments.author_id, pero guardarlo evita un JOIN en cada lectura y deja
    # la fila auto-explicativa (ADR-023 §Modelo de datos).
    author_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Exactamente una de las dos (ck_mentions_exactly_one_target).
    post_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("posts.id", ondelete="CASCADE"),
        nullable=True,
    )
    comment_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("comments.id", ondelete="CASCADE"),
        nullable=True,
    )

    created_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    # Sin `updated_at` ni `edited_at`: una mención no se edita. Si se edita el
    # texto que la contenía, las menciones de esa fila se recalculan --
    # se borran las que ya no están y se crean las nuevas (ADR-023 §Decisión).

    # lazy="joined": renderizar un post/comentario siempre necesita el
    # username de cada mención para enlazarla -- evita el N+1 (mismo motivo
    # que Post.author).
    mentioned_user = db.relationship(
        "User", foreign_keys=[mentioned_user_id], lazy="joined"
    )

    __table_args__ = (
        # Tercera CHECK del esquema, después de ck_follows_no_self_follow
        # (ADR-007) y ck_messages_no_self_message (ADR-013). `<>` sobre dos
        # IS NULL: exactamente uno de los dos targets presente.
        db.CheckConstraint(
            "(post_id IS NULL) <> (comment_id IS NULL)",
            name="ck_mentions_exactly_one_target",
        ),
    )

    def __repr__(self):
        return f"<Mention id={self.id} user={self.mentioned_user_id}>"


class MutedKeyword(db.Model):
    __tablename__ = "muted_keywords"

    # Duodécima entidad del alcance objetivo del producto en pasar a ratificada
    # (ADR-024-content-filters-and-privacy-preferences.md) -- resuelve
    # "Filtros de palabras clave personalizadas" de REF-SET-02.
    #
    # Tabla y no un array/JSON en `users`: hay que poder preguntar "¿algún
    # keyword de este usuario aparece en este texto?" desde el mismo WHERE que
    # lista posts/comentarios (ADR-024 §Opciones consideradas).

    id = db.Column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )

    user_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Normalizada a minúsculas por la aplicación antes de insertar
    # (domain/moderation/keyword_matching.py), así que la UNIQUE distingue
    # términos realmente distintos y no variaciones de mayúsculas. Acotada en
    # el esquema, a diferencia de `content` (TEXT): un keyword no es texto
    # libre.
    keyword = db.Column(db.String(100), nullable=False)

    created_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    __table_args__ = (
        db.UniqueConstraint("user_id", "keyword", name="uq_muted_keywords_user_keyword"),
    )

    def __repr__(self):
        return f"<MutedKeyword user={self.user_id} keyword={self.keyword!r}>"


class MutedTopic(db.Model):
    __tablename__ = "muted_topics"

    # Temas silenciados (ADR-030-content-preferences.md). Un «tema» es un
    # hashtag (`#viajes`): el producto no tiene entidad de temas ni etiquetas
    # guardadas, así que el tema se reconoce DENTRO del texto de la publicación.
    # Tabla propia y no reutilizar `muted_keywords`: una palabra se busca como
    # subcadena (`spoiler` también oculta `spoilers`) y un tema se busca como
    # etiqueta completa (`#viaje` no oculta `#viajes`).

    id = db.Column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )

    user_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Sin el `#`, en minúsculas (domain/moderation/topic_matching.py).
    topic = db.Column(db.String(50), nullable=False)

    created_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    __table_args__ = (
        db.UniqueConstraint("user_id", "topic", name="uq_muted_topics_user_topic"),
    )

    def __repr__(self):
        return f"<MutedTopic user={self.user_id} topic={self.topic!r}>"


class Session(db.Model):
    __tablename__ = "sessions"

    # Decimotercera entidad del alcance objetivo del producto en pasar a
    # ratificada (ADR-025-session-registry.md) -- resuelve "Sesiones activas"
    # y habilita "Alertas de inicio de sesión" (REF-SET-03).
    #
    # Es la entidad que convierte el JWT de puramente *stateless* a verificado
    # contra la base de datos en cada petición protegida. El token sigue siendo
    # autocontenido y firmado; lo que se añade es que su `jti` tiene que tener
    # una fila viva acá (ver extensions.py, token_in_blocklist_loader).

    id = db.Column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )

    user_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )

    # `jti` del JWT, generado por flask_jwt_extended (UUID v4 en texto).
    # VARCHAR(36) y no UUID nativo: es un valor que produce la librería, no el
    # esquema, y tratarlo como texto evita depender de que su formato siga
    # siendo exactamente un UUID.
    jti = db.Column(db.String(36), nullable=False)

    # Familia de refresh tokens del mismo login (ADR-017). Una fila de sesión
    # por login: al renovar, `jti` se re-vincula al access token nuevo en vez
    # de crear otra fila. NULL = sesión sin refresh token.
    refresh_family_id = db.Column(PG_UUID(as_uuid=True), nullable=True)

    # Lo que el cliente dijo de sí mismo. Se guarda crudo y sin validar -- no
    # es un dato de confianza, es una pista para que la persona reconozca el
    # dispositivo. Es el Frontend quien lo resume para mostrarlo.
    user_agent = db.Column(db.Text, nullable=True)

    # 45 caracteres: longitud máxima de una IPv6 en texto (incluido el formato
    # mapeado a IPv4). Nullable: detrás de algunos proxies puede no resolverse.
    ip_address = db.Column(db.String(45), nullable=True)

    created_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    # Con throttle, igual que User.last_seen_at (ADR-024) y por el mismo
    # motivo: sin él, el polling del chat escribiría en cada petición.
    last_used_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    # NULL = sesión viva. Revocar no borra la fila: "cerré sesión en ese
    # dispositivo" queda registrado, y la lista puede distinguir una sesión que
    # terminó de una que nunca existió (ADR-025 §Decisión).
    revoked_at = db.Column(db.DateTime(timezone=True), nullable=True)

    __table_args__ = (
        db.UniqueConstraint("jti", name="uq_sessions_jti"),
        db.Index("ix_sessions_refresh_family_id", "refresh_family_id"),
        # Listar las sesiones de una persona, más reciente primero. La UNIQUE de
        # `jti` cubre el acceso caliente (una búsqueda por token en cada
        # petición protegida) pero no este, que lidera por otra columna.
        db.Index("ix_sessions_user_id_created_at", "user_id", "created_at"),
    )

    def __repr__(self):
        return f"<Session id={self.id} user_id={self.user_id} revoked={self.revoked_at is not None}>"


class TwoFactorRecoveryCode(db.Model):
    __tablename__ = "two_factor_recovery_codes"

    # Decimocuarta entidad del alcance objetivo del producto en pasar a
    # ratificada (ADR-026-two-factor-authentication.md). Códigos de un solo uso
    # para entrar cuando se pierde el dispositivo con la app autenticadora --
    # sin ellos, perder el teléfono significaría perder la cuenta.

    id = db.Column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )

    user_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Hash scrypt del código, nunca el valor crudo -- mismo criterio que
    # PasswordResetToken.code_hash (ADR-010) y EmailVerificationToken.code_hash
    # (ADR-011). Acá SÍ se puede hashear, a diferencia de User.totp_secret: el
    # código viaja una vez y solo hay que compararlo, no reconstruirlo.
    code_hash = db.Column(db.Text, nullable=False)

    created_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    # NULL = sin usar. Se marca en vez de borrar la fila: así se puede informar
    # cuántos quedan sin perder el rastro de cuántos se gastaron.
    used_at = db.Column(db.DateTime(timezone=True), nullable=True)

    __table_args__ = (
        db.Index("ix_two_factor_recovery_codes_user_id", "user_id"),
    )

    def __repr__(self):
        return f"<TwoFactorRecoveryCode user_id={self.user_id} used={self.used_at is not None}>"


class RateLimitBucket(db.Model):
    __tablename__ = "rate_limit_buckets"

    # Decimoquinta entidad del alcance objetivo del producto en pasar a
    # ratificada (ADR-027-rate-limiting.md). Contador de ventana fija: una fila
    # por (scope, identidad), con los intentos de la ventana en curso.
    #
    # Es la única entidad del esquema que no modela un hecho del producto sino
    # una defensa operativa -- de ahí que no tenga FK a `users` (ver abajo) ni
    # aparezca en ninguna respuesta de la API.

    id = db.Column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )

    # Qué se limita: 'login', '2fa_verify', 'register'... Los valores viven en
    # domain/rate_limiting/policy.py, no en el esquema -- agregar un scope nuevo
    # no debe exigir una migración (mismo criterio que Notification.type,
    # ADR-008, y Follow.status, ADR-022).
    scope = db.Column(db.String(40), nullable=False)

    # SHA-256 de la identidad (una IP, un email, un user_id), en hexadecimal:
    # siempre 64 caracteres, de ahí el CHAR fijo.
    #
    # Se hashea a propósito: esta tabla solo necesita **contar**, nunca saber de
    # quién. Guardar emails o IPs en claro acumularía datos personales en una
    # tabla puramente operativa cuando un hash cumple la misma función
    # (ADR-027 §Seguridad) -- mismo criterio que PasswordResetToken.code_hash:
    # si no hace falta el valor original, no se guarda.
    identity_hash = db.Column(db.CHAR(64), nullable=False)

    window_started_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    attempts = db.Column(db.Integer, nullable=False, server_default=text("0"))

    # Sin `created_at`/`updated_at`: `window_started_at` ya es el timestamp que
    # importa, y la fila se reutiliza (se reinicia la ventana) en vez de crearse
    # una nueva por período.

    __table_args__ = (
        db.UniqueConstraint("scope", "identity_hash", name="uq_rate_limit_scope_identity"),
        # Para purgar las ventanas vencidas. El UPSERT no lo necesita -- ese va
        # por la UNIQUE de arriba.
        db.Index("ix_rate_limit_buckets_window_started_at", "window_started_at"),
    )

    # Sin FK a `users` a propósito: la identidad puede ser una IP, o el email de
    # una cuenta que no existe (un intento de login contra un email inventado
    # también tiene que contar). Atarla a `users` dejaría fuera justamente los
    # casos que más interesa limitar.

    def __repr__(self):
        return f"<RateLimitBucket scope={self.scope!r} attempts={self.attempts}>"


class DataExport(db.Model):
    __tablename__ = "data_exports"

    # Exportación de datos personales (ADR-028-data-export.md). Una fila por
    # archivo generado: el ZIP vive en `content` mientras no caduque, y es lo
    # único de esta tabla que no es metadato.
    #
    # El archivo se guarda en la base y no en disco a propósito: el proyecto no
    # tiene almacenamiento de archivos (ni DevOps documentado), y un volumen
    # local se perdería o desincronizaría con varios workers -- mismo
    # razonamiento que rate_limit_buckets (ADR-027).

    id = db.Column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )

    user_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )

    file_name = db.Column(db.String(120), nullable=False)
    size_bytes = db.Column(db.Integer, nullable=False)

    # NULL = el archivo caducó y se descartó; la fila se conserva como
    # historial ("caducado"), el contenido no.
    content = db.Column(db.LargeBinary, nullable=True)

    created_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    expires_at = db.Column(db.DateTime(timezone=True), nullable=False)

    downloaded_at = db.Column(db.DateTime(timezone=True), nullable=True)
    download_count = db.Column(
        db.Integer, nullable=False, server_default=text("0")
    )

    __table_args__ = (
        db.Index("ix_data_exports_user_created", "user_id", "created_at"),
    )

    def __repr__(self):
        return f"<DataExport id={self.id} user_id={self.user_id}>"


class UserRestriction(db.Model):
    __tablename__ = "user_restrictions"

    # Bloqueo y restricción de cuentas (ADR-029-blocked-and-restricted-accounts.md).
    # UNA fila por par (dueño, destino) con un `kind`: una cuenta está bloqueada
    # O restringida, nunca las dos a la vez (bloquear reemplaza a restringir).
    # Una sola tabla con discriminador y no dos tablas gemelas -- mismo criterio
    # que Notification.type (ADR-008) y Follow.status (ADR-022).

    id = db.Column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )

    # Quién bloquea/restringe.
    owner_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    # A quién.
    target_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )

    # 'block' | 'restrict'. Validado en la aplicación (domain/restrictions/kinds.py).
    kind = db.Column(db.String(10), nullable=False)

    created_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    target = db.relationship("User", foreign_keys=[target_id], lazy="joined")

    __table_args__ = (
        db.UniqueConstraint("owner_id", "target_id", name="uq_user_restrictions_pair"),
        db.CheckConstraint("owner_id <> target_id", name="ck_user_restrictions_no_self"),
        # "¿alguien me bloqueó a mí?" busca por target_id.
        db.Index("ix_user_restrictions_target", "target_id", "kind"),
    )

    def __repr__(self):
        return f"<UserRestriction {self.kind} owner={self.owner_id} target={self.target_id}>"

class RefreshToken(db.Model):
    __tablename__ = "refresh_tokens"

    # ADR-017-jwt-session-policy.md. Una fila por refresh token emitido. Cada
    # login abre una familia (`family_id`); cada renovación consume la fila
    # vigente y crea la siguiente de la misma familia (rotación, ADR-017 §2).

    id = db.Column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )

    user_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Identifica la cadena de renovaciones de un mismo login/dispositivo. Se
    # revoca entera ante reuso de un token consumido o ante logout.
    family_id = db.Column(PG_UUID(as_uuid=True), nullable=False)

    # SHA-256 hexadecimal del `jti` del refresh token (ADR-017 §7 decisión 3):
    # el `jti` es un UUID v4 aleatorio dentro de un JWT firmado, de alta
    # entropía, así que no hace falta un hash lento (a diferencia de los OTP
    # de 6 dígitos). Nunca se guarda el token ni su `jti` en claro.
    token_hash = db.Column(db.String(64), nullable=False)

    created_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    expires_at = db.Column(db.DateTime(timezone=True), nullable=False)

    # NULL = vigente. Se fija al consumirlo en una renovación.
    used_at = db.Column(db.DateTime(timezone=True), nullable=True)

    # NULL = no revocado. Se fija en toda la familia ante reuso, logout o
    # cambio de contraseña.
    revoked_at = db.Column(db.DateTime(timezone=True), nullable=True)

    # Sucesor emitido al consumir este token (trazabilidad de la cadena).
    replaced_by_id = db.Column(PG_UUID(as_uuid=True), nullable=True)

    __table_args__ = (
        # Lookup de POST /api/refresh y /api/logout por el hash del `jti`.
        db.Index("uq_refresh_tokens_token_hash", "token_hash", unique=True),
        db.Index("ix_refresh_tokens_user_id", "user_id"),
        db.Index("ix_refresh_tokens_family_id", "family_id"),
        # ADR-017 §4.3: a lo sumo UN token activo (sin usar y sin revocar) por
        # familia -- defensa de última línea contra dos rotaciones
        # simultáneas del mismo token. Mismo patrón que
        # `uq_password_reset_tokens_active_user` (ADR-010).
        db.Index(
            "uq_refresh_tokens_active_family",
            "family_id",
            unique=True,
            postgresql_where=text("used_at IS NULL AND revoked_at IS NULL"),
        ),
    )

    def __repr__(self):
        return f"<RefreshToken user_id={self.user_id} family_id={self.family_id}>"


class Report(db.Model):
    __tablename__ = "reports"

    # ADR-032-content-reports-and-moderation.md §1. Un reporte de un post,
    # comentario, mensaje o cuenta, hecho por una persona.

    id = db.Column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )

    # SET NULL, no CASCADE: si quien reportó elimina su cuenta (ADR-031), el
    # reporte sigue, porque lo reportado puede seguir siendo un problema. El
    # reporte queda sin autor; no se conserva ningún dato de esa persona.
    reporter_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    # "post" | "comment" | "message" | "user", validado en la aplicación
    # (`domain/reports/kinds.py`). `target_id` NO tiene clave foránea: apunta a
    # tablas distintas según `target_type`.
    target_type = db.Column(db.String(10), nullable=False)
    target_id = db.Column(PG_UUID(as_uuid=True), nullable=False)

    # Autor del contenido, o la propia cuenta reportada. SET NULL por lo mismo.
    reported_user_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    reason = db.Column(db.String(20), nullable=False)
    details = db.Column(db.String(500), nullable=True)

    # "open" | "reviewing" | "actioned" | "dismissed". Lo cambian las rutas de
    # moderación (fase 2); en esta fase todo reporte nace y queda `open`.
    status = db.Column(db.String(10), nullable=False, server_default=text("'open'"))

    # Prioridad de revisión (ADR-038): `normal` o `critical`. La asigna el servidor a partir
    # del motivo (`domain/reports/kinds.priority_for_reason`); el cliente no la envía.
    priority = db.Column(db.String(10), nullable=False, server_default=text("'normal'"))

    # Copia del texto reportado, para que quien modera vea qué se dijo aunque el
    # contenido se borre o su autor elimine la cuenta (ADR-032 §4). Se vacía al
    # resolver el reporte; no se guardan imágenes ni nombres.
    content_snapshot = db.Column(db.Text, nullable=True)

    created_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    resolved_at = db.Column(db.DateTime(timezone=True), nullable=True)
    resolved_by = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    resolution_note = db.Column(db.String(500), nullable=True)

    __table_args__ = (
        # Reportar lo mismo dos veces es idempotente (ADR-032 §1). Con
        # `reporter_id` NULL (cuenta eliminada) PostgreSQL no considera iguales
        # dos filas, así que no se bloquean entre sí: es lo deseado.
        db.Index(
            "uq_reports_reporter_target",
            "reporter_id",
            "target_type",
            "target_id",
            unique=True,
        ),
        # La cola de moderación: abiertos primero, del más antiguo al más nuevo.
        db.Index("ix_reports_status_created_at", "status", "created_at"),
        # Cola de revisión futura: lo crítico primero (ADR-038).
        db.Index("ix_reports_status_priority_created_at", "status", "priority", "created_at"),
        db.CheckConstraint("priority IN ('normal', 'critical')", name="ck_reports_priority"),
        db.Index("ix_reports_reported_user_id", "reported_user_id"),
    )

    def __repr__(self):
        return f"<Report {self.target_type}:{self.target_id} reason={self.reason!r}>"

class AccountDeletionCode(db.Model):
    """Código de un solo uso para confirmar la eliminación de una cuenta
    (ADR-031-account-deletion.md). Tabla propia, no `password_reset_tokens`: un
    código de recuperación nunca debe servir para borrar una cuenta."""

    __tablename__ = "account_deletion_codes"

    id = db.Column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    user_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    # scrypt del código de 6 dígitos (nunca el código en claro).
    code_hash = db.Column(db.Text, nullable=False)
    attempts = db.Column(db.Integer, nullable=False, server_default=text("0"))
    expires_at = db.Column(db.DateTime(timezone=True), nullable=False)
    used_at = db.Column(db.DateTime(timezone=True), nullable=True)
    created_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    __table_args__ = (
        # A lo sumo un código activo por cuenta.
        db.Index(
            "uq_account_deletion_codes_active_user",
            "user_id",
            unique=True,
            postgresql_where=text("used_at IS NULL"),
        ),
    )


# --- THERS Places (ADR-040-thers-places.md, fase 1) ---


class Geography(UserDefinedType):
    """`geography(Point, 4326)` de PostGIS, sin depender de `geoalchemy2`
    (ADR-040 R3: su compatibilidad con Python 3.14 no está verificada).

    El ORM solo necesita conocer la columna; las lecturas y escrituras de la
    ubicación se hacen con SQL `ST_*` explícito en el repositorio
    (`place_repository.py`) y en el seed."""

    cache_ok = True

    def get_col_spec(self, **kw):
        return "geography(Point,4326)"


class PlaceCategory(db.Model):
    __tablename__ = "place_categories"

    id = db.Column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    slug = db.Column(db.String(60), nullable=False, unique=True)
    name = db.Column(db.String(80), nullable=False)
    sort_order = db.Column(db.Integer, nullable=False, server_default=text("0"))
    is_active = db.Column(db.Boolean, nullable=False, server_default=text("true"))


class Place(db.Model):
    __tablename__ = "places"

    # Los valores permitidos de `verification_status`, `source` y
    # `coordinate_source` viven en `domain/places/kinds.py`. La base los
    # refuerza con un CHECK (no un ENUM): agregar uno exige tocar el CHECK, pero
    # un valor inválido nunca llega a guardarse.
    __table_args__ = (
        CheckConstraint(
            "verification_status IN ('pending','verified','needs_review','rejected','inactive')",
            name="ck_places_verification_status",
        ),
        CheckConstraint(
            "source IN ('thers_field','business','community','osm','official')",
            name="ck_places_source",
        ),
        CheckConstraint(
            "coordinate_source IN ('gps','map_selected','geocoded','imported')",
            name="ck_places_coordinate_source",
        ),
        Index("ix_places_location", "location", postgresql_using="gist"),
        Index("ix_places_category_id", "category_id"),
        Index("ix_places_public", "is_active", "verification_status"),
    )

    id = db.Column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    name = db.Column(db.String(160), nullable=False)
    slug = db.Column(db.String(180), nullable=False, unique=True)
    description = db.Column(db.Text, nullable=True)
    category_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("place_categories.id", ondelete="RESTRICT"),
        nullable=False,
    )

    # Punto geográfico (WGS 84). Índice GiST: las búsquedas por distancia
    # (`ST_DWithin`) y el orden por cercanía lo aprovechan.
    location = db.Column(Geography(), nullable=False)

    address = db.Column(db.String(255), nullable=True)
    municipality = db.Column(db.String(100), nullable=True)
    department = db.Column(db.String(100), nullable=True)
    phone = db.Column(db.String(40), nullable=True)
    website = db.Column(db.String(255), nullable=True)

    verification_status = db.Column(
        db.String(20), nullable=False, server_default=text("'pending'")
    )
    source = db.Column(db.String(20), nullable=False)
    coordinate_source = db.Column(db.String(20), nullable=False)
    is_active = db.Column(db.Boolean, nullable=False, server_default=text("true"))

    # SET NULL: si quien creó o verificó elimina su cuenta (ADR-031), el lugar
    # sigue; solo se pierde la referencia a la persona.
    created_by_user_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    verified_by_user_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    last_verified_at = db.Column(db.DateTime(timezone=True), nullable=True)

    created_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    updated_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=text("now()")
    )


# --- THERS Places, fase 2 (ADR-040-thers-places.md) ---


class SavedPlace(db.Model):
    __tablename__ = "saved_places"

    # PK compuesta: la base impide guardar dos veces el mismo lugar. CASCADE en
    # ambas FKs: al borrar la cuenta (ADR-031) desaparecen sus guardados.
    user_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    place_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("places.id", ondelete="CASCADE"),
        primary_key=True,
    )
    created_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=text("now()")
    )


class PlaceReport(db.Model):
    __tablename__ = "place_reports"

    # Los motivos y estados permitidos viven en `domain/places/kinds.py`; la base
    # los refuerza con CHECK.
    __table_args__ = (
        CheckConstraint(
            "reason IN ('wrong_location','wrong_hours','wrong_phone','closed','duplicate',"
            "'wrong_name','inappropriate','other')",
            name="ck_place_reports_reason",
        ),
        CheckConstraint(
            "status IN ('open','reviewing','resolved','dismissed')",
            name="ck_place_reports_status",
        ),
    )

    id = db.Column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    place_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("places.id", ondelete="CASCADE"),
        nullable=False,
    )
    # SET NULL, no CASCADE: el reporte sobrevive a quien lo hizo (mismo criterio
    # que `reports`, ADR-032). Queda sin autor; no se conserva dato de esa persona.
    reporter_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    reason = db.Column(db.String(20), nullable=False)
    details = db.Column(db.String(500), nullable=True)
    status = db.Column(db.String(10), nullable=False, server_default=text("'open'"))
    resolved_by_user_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    resolved_at = db.Column(db.DateTime(timezone=True), nullable=True)
    resolution_note = db.Column(db.String(500), nullable=True)
    created_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=text("now()")
    )


class AdminAuditLog(db.Model):
    __tablename__ = "admin_audit_log"

    # Registro de acciones de moderación sobre lugares. NUNCA guarda secretos,
    # tokens ni contraseñas: `changes` solo lleva los campos públicos que cambiaron.
    id = db.Column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    # SET NULL: el registro debe sobrevivir a la cuenta de quien actuó.
    actor_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    action = db.Column(db.String(40), nullable=False)
    resource_type = db.Column(db.String(30), nullable=False)
    resource_id = db.Column(PG_UUID(as_uuid=True), nullable=True)
    changes = db.Column(JSONB, nullable=True)
    # `human` | `system` (ADR-044): distingue una decisión automática de una de una persona.
    actor_kind = db.Column(db.String(8), nullable=False, server_default=text("'human'"))
    created_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=text("now()")
    )


# --- THERS Places, fase 4a: reseñas (ADR-040-thers-places.md) ---


class PlaceReview(db.Model):
    __tablename__ = "place_reviews"

    # Una reseña por persona y lugar. CASCADE: al eliminar la cuenta (ADR-031) o el
    # lugar desaparecen. `is_hidden` lo cambia solo la moderación.
    __table_args__ = (
        CheckConstraint("rating BETWEEN 1 AND 5", name="ck_place_reviews_rating"),
        db.UniqueConstraint("user_id", "place_id", name="uq_place_reviews_user_place"),
        db.Index("ix_place_reviews_place_created", "place_id", "created_at"),
    )

    id = db.Column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    place_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("places.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    rating = db.Column(db.SmallInteger, nullable=False)
    body = db.Column(db.Text, nullable=True)
    is_hidden = db.Column(db.Boolean, nullable=False, server_default=text("false"))
    created_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    updated_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=text("now()")
    )


class PlacePlan(db.Model):
    __tablename__ = "place_plans"

    # Plan de salida a un lugar con amistades (ADR-040 fase 5). CASCADE: al borrarse
    # la cuenta de quien lo creó (ADR-031) o el lugar, el plan desaparece. `status`
    # ('active'/'cancelled') tiene CHECK; cancelar conserva la fila para que las
    # personas invitadas vean que ya no va.
    __table_args__ = (
        CheckConstraint("status IN ('active','cancelled')", name="ck_place_plans_status"),
        db.Index("ix_place_plans_place", "place_id"),
        db.Index("ix_place_plans_creator_starts", "creator_id", "starts_at"),
    )

    id = db.Column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    place_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("places.id", ondelete="CASCADE"),
        nullable=False,
    )
    creator_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    title = db.Column(db.String(80), nullable=False)
    note = db.Column(db.Text, nullable=True)
    starts_at = db.Column(db.DateTime(timezone=True), nullable=False)
    status = db.Column(db.String(12), nullable=False, server_default=text("'active'"))
    created_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    updated_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=text("now()")
    )


class PlacePlanMember(db.Model):
    __tablename__ = "place_plan_members"

    # Quien creó el plan también tiene fila (siempre 'going').
    # `status`: 'invited' / 'going' / 'declined'.
    __table_args__ = (
        CheckConstraint(
            "status IN ('invited','going','declined')", name="ck_place_plan_members_status"
        ),
        db.UniqueConstraint("plan_id", "user_id", name="uq_place_plan_members_pair"),
        db.Index("ix_place_plan_members_user", "user_id"),
    )

    id = db.Column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    plan_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("place_plans.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    invited_by = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    status = db.Column(db.String(12), nullable=False)
    created_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    updated_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=text("now()")
    )


# --- THERS Places, fase 6: reclamos de negocio (ADR-040-thers-places.md) ---


class PlaceClaim(db.Model):
    __tablename__ = "place_claims"

    # `document_key` apunta al almacenamiento PRIVADO y se vacía al resolver el reclamo.
    id = db.Column(
        PG_UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    place_id = db.Column(
        PG_UUID(as_uuid=True), db.ForeignKey("places.id", ondelete="CASCADE"), nullable=False
    )
    claimant_id = db.Column(
        PG_UUID(as_uuid=True), db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    status = db.Column(db.String(12), nullable=False, server_default="pending")
    business_name = db.Column(db.String(160), nullable=False)
    contact_phone = db.Column(db.String(40), nullable=True)
    message = db.Column(db.Text, nullable=True)
    document_key = db.Column(db.String(255), nullable=True)
    document_content_type = db.Column(db.String(40), nullable=True)
    reviewed_by = db.Column(
        PG_UUID(as_uuid=True), db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reviewed_at = db.Column(db.DateTime(timezone=True), nullable=True)
    review_note = db.Column(db.Text, nullable=True)
    created_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    updated_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=text("now()")
    )


class PlaceManager(db.Model):
    __tablename__ = "place_managers"

    # Rol de gestor de UN lugar, distinto de `users.is_moderator` (que es de la plataforma).
    id = db.Column(
        PG_UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    place_id = db.Column(
        PG_UUID(as_uuid=True), db.ForeignKey("places.id", ondelete="CASCADE"), nullable=False
    )
    user_id = db.Column(
        PG_UUID(as_uuid=True), db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    claim_id = db.Column(
        PG_UUID(as_uuid=True), db.ForeignKey("place_claims.id", ondelete="SET NULL"), nullable=True
    )
    granted_by = db.Column(
        PG_UUID(as_uuid=True), db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=text("now()")
    )


# --- THERS Places, fase 7: respuestas del negocio a reseñas (ADR-040-thers-places.md) ---


class PlaceReviewReply(db.Model):
    __tablename__ = "place_review_replies"

    id = db.Column(
        PG_UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    review_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("place_reviews.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    place_id = db.Column(
        PG_UUID(as_uuid=True), db.ForeignKey("places.id", ondelete="CASCADE"), nullable=False
    )
    author_id = db.Column(
        PG_UUID(as_uuid=True), db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    body = db.Column(db.Text, nullable=False)
    created_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    updated_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=text("now()")
    )


# --- THERS Places, fase 8: reservas (ADR-040-thers-places.md) ---


class PlaceReservationSettings(db.Model):
    __tablename__ = "place_reservation_settings"

    place_id = db.Column(
        PG_UUID(as_uuid=True), db.ForeignKey("places.id", ondelete="CASCADE"), primary_key=True
    )
    enabled = db.Column(db.Boolean, nullable=False, server_default=text("false"))
    capacity = db.Column(db.Integer, nullable=False, server_default="10")
    max_party_size = db.Column(db.Integer, nullable=False, server_default="8")
    updated_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=text("now()")
    )


class PlaceReservation(db.Model):
    __tablename__ = "place_reservations"

    id = db.Column(
        PG_UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    place_id = db.Column(
        PG_UUID(as_uuid=True), db.ForeignKey("places.id", ondelete="CASCADE"), nullable=False
    )
    user_id = db.Column(
        PG_UUID(as_uuid=True), db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    starts_at = db.Column(db.DateTime(timezone=True), nullable=False)
    party_size = db.Column(db.Integer, nullable=False)
    note = db.Column(db.Text, nullable=True)
    status = db.Column(db.String(12), nullable=False, server_default="pending")
    decided_by = db.Column(
        PG_UUID(as_uuid=True), db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    decision_note = db.Column(db.Text, nullable=True)
    created_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    updated_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=text("now()")
    )


# --- THERS Places, fase 10: cotizador (ADR-040-thers-places.md) ---


class PlaceQuoteItem(db.Model):
    __tablename__ = "place_quote_items"

    id = db.Column(
        PG_UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    place_id = db.Column(
        PG_UUID(as_uuid=True), db.ForeignKey("places.id", ondelete="CASCADE"), nullable=False
    )
    name = db.Column(db.String(120), nullable=False)
    description = db.Column(db.String(300), nullable=True)
    unit = db.Column(db.String(10), nullable=False)
    # Dinero siempre en centavos enteros (USD), nunca float.
    unit_price_cents = db.Column(db.Integer, nullable=False)
    is_active = db.Column(db.Boolean, nullable=False, server_default=text("true"))
    created_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    updated_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=text("now()")
    )


class PlaceQuote(db.Model):
    __tablename__ = "place_quotes"

    id = db.Column(
        PG_UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    place_id = db.Column(
        PG_UUID(as_uuid=True), db.ForeignKey("places.id", ondelete="CASCADE"), nullable=False
    )
    user_id = db.Column(
        PG_UUID(as_uuid=True), db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    reservation_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("place_reservations.id", ondelete="SET NULL"),
        nullable=True,
    )
    currency = db.Column(db.String(3), nullable=False, server_default="USD")
    total_cents = db.Column(db.BigInteger, nullable=False)
    note = db.Column(db.Text, nullable=True)
    valid_until = db.Column(db.DateTime(timezone=True), nullable=False)
    created_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    # Fase 11: el negocio acepta o rechaza; sin cobro.
    status = db.Column(db.String(10), nullable=False, server_default="pending")
    decided_at = db.Column(db.DateTime(timezone=True), nullable=True)
    decided_by = db.Column(
        PG_UUID(as_uuid=True), db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class PlaceQuoteLine(db.Model):
    __tablename__ = "place_quote_lines"

    id = db.Column(
        PG_UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    quote_id = db.Column(
        PG_UUID(as_uuid=True), db.ForeignKey("place_quotes.id", ondelete="CASCADE"), nullable=False
    )
    item_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("place_quote_items.id", ondelete="SET NULL"),
        nullable=True,
    )
    # Copia del artículo al cotizar.
    name = db.Column(db.String(120), nullable=False)
    unit = db.Column(db.String(10), nullable=False)
    unit_price_cents = db.Column(db.Integer, nullable=False)
    quantity = db.Column(db.Integer, nullable=False)
    line_total_cents = db.Column(db.BigInteger, nullable=False)
    position = db.Column(db.SmallInteger, nullable=False, server_default="0")


# --- THERS Places, fase 16 parte 2: visitas anónimas (ADR-040 §33) ---


class PlaceVisitCount(db.Model):
    __tablename__ = "place_visit_counts"

    # Contador por lugar, día LOCAL (UTC-6) y evento. Sin user_id a propósito (ADR-040 §33).
    place_id = db.Column(
        PG_UUID(as_uuid=True), db.ForeignKey("places.id", ondelete="CASCADE"), primary_key=True
    )
    day = db.Column(db.Date, primary_key=True)
    event = db.Column(db.String(16), primary_key=True)
    count = db.Column(db.Integer, nullable=False, server_default="0")


# --- Tero, fase 4: gasto mensual de IA (ADR-041 §8.2) ---


class TeroUsage(db.Model):
    __tablename__ = "tero_usage"

    # Un contador GLOBAL por mes UTC (`YYYY-MM`). Sin user_id a propósito: sirve solo para cortar
    # el gasto al llegar al tope y no hay nada que exportar ni borrar por persona (ADR-028/031).
    period = db.Column(db.String(7), primary_key=True)
    input_tokens = db.Column(db.BigInteger, nullable=False, server_default="0")
    output_tokens = db.Column(db.BigInteger, nullable=False, server_default="0")
    cost_micro_usd = db.Column(db.BigInteger, nullable=False, server_default="0")
    updated_at = db.Column(db.DateTime(timezone=True), nullable=False, server_default=text("now()"))

    __table_args__ = (
        CheckConstraint("period ~ '^[0-9]{4}-[0-9]{2}$'", name="ck_tero_usage_period"),
        CheckConstraint(
            "input_tokens >= 0 AND output_tokens >= 0 AND cost_micro_usd >= 0",
            name="ck_tero_usage_nonnegative",
        ),
    )


# --- Tero, fase 6: acciones propuestas por el asistente que esperan confirmación (ADR-041 §6.2) ---


class TeroPendingAction(db.Model):
    __tablename__ = "tero_pending_actions"

    id = db.Column(
        PG_UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    # De la persona que chatea (JWT), nunca de lo que diga el modelo. CASCADE: al borrar la
    # cuenta se borran sus acciones (ADR-031).
    user_id = db.Column(
        PG_UUID(as_uuid=True), db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    kind = db.Column(db.String(32), nullable=False)
    # Parámetros YA validados por el servidor (ids resueltos, texto limpio). Es lo único que se
    # ejecuta al confirmar: nada que escriba el modelo después cambia lo que se aprobó.
    params = db.Column(JSONB, nullable=False)
    # Lo que ve la persona en la tarjeta de confirmación, redactado por el SERVIDOR a partir de
    # `params`, no por el modelo: lo que se aprueba es exactamente lo que se ejecuta.
    summary = db.Column(db.String(300), nullable=False)
    status = db.Column(db.String(12), nullable=False, server_default="pending")
    expires_at = db.Column(db.DateTime(timezone=True), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, server_default=text("now()"))
    resolved_at = db.Column(db.DateTime(timezone=True), nullable=True)

    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'confirmed', 'cancelled', 'failed')",
            name="ck_tero_pending_actions_status",
        ),
        CheckConstraint(
            "(status = 'pending') = (resolved_at IS NULL)",
            name="ck_tero_pending_actions_resolved",
        ),
        Index("ix_tero_pending_actions_user_created", "user_id", "created_at"),
    )


# --- Moderación de contenido (ADR-044) ---


class ModerationJob(db.Model):
    __tablename__ = "moderation_jobs"

    # Cola persistente (outbox). El payload son SOLO identificadores: nunca el contenido.
    id = db.Column(
        PG_UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    kind = db.Column(db.String(24), nullable=False)
    subject_type = db.Column(db.String(24), nullable=False)
    subject_id = db.Column(PG_UUID(as_uuid=True), nullable=False)
    # Único: encolar dos veces el mismo hecho no crea un segundo trabajo.
    idempotency_key = db.Column(db.String(120), nullable=False, unique=True)
    status = db.Column(db.String(10), nullable=False, server_default=text("'queued'"))
    attempts = db.Column(db.SmallInteger, nullable=False, server_default=text("0"))
    next_attempt_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    locked_by = db.Column(db.String(60), nullable=True)
    locked_at = db.Column(db.DateTime(timezone=True), nullable=True)
    # Clase del error, nunca texto del proveedor ni del contenido.
    last_error = db.Column(db.String(200), nullable=True)
    created_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    finished_at = db.Column(db.DateTime(timezone=True), nullable=True)

    __table_args__ = (
        db.CheckConstraint(
            "status IN ('queued', 'running', 'succeeded', 'failed', 'dead')",
            name="ck_moderation_jobs_status",
        ),
        db.Index("ix_moderation_jobs_subject", "subject_type", "subject_id"),
    )


class ModerationResult(db.Model):
    __tablename__ = "moderation_results"

    # Lo que dijo el clasificador y lo que decidió el motor. SIN el contenido evaluado.
    id = db.Column(
        PG_UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    job_id = db.Column(
        PG_UUID(as_uuid=True),
        db.ForeignKey("moderation_jobs.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    provider = db.Column(db.String(40), nullable=False)
    model_version = db.Column(db.String(60), nullable=False)
    categories = db.Column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    scores = db.Column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    # Sin 'rejected': la base impide que una decisión automática rechace (ADR-044 §2.3).
    decision = db.Column(db.String(10), nullable=False)
    priority = db.Column(db.String(8), nullable=False, server_default=text("'normal'"))
    policy_version = db.Column(db.String(20), nullable=False)
    created_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    __table_args__ = (
        db.CheckConstraint(
            "decision IN ('approved', 'held', 'pending')", name="ck_moderation_results_decision"
        ),
        db.CheckConstraint(
            "priority IN ('normal', 'high', 'critical')", name="ck_moderation_results_priority"
        ),
    )


class ModerationAppeal(db.Model):
    __tablename__ = "moderation_appeals"

    # Apelación de una persona contra la retención o el rechazo de su contenido (ADR-044 §2.7).
    id = db.Column(
        PG_UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    user_id = db.Column(
        PG_UUID(as_uuid=True), db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    subject_type = db.Column(db.String(24), nullable=False)
    subject_id = db.Column(PG_UUID(as_uuid=True), nullable=False)
    reason = db.Column(db.String(500), nullable=False)
    status = db.Column(db.String(10), nullable=False, server_default=text("'open'"))
    original_decided_by = db.Column(db.String(40), nullable=True)
    reviewer_id = db.Column(
        PG_UUID(as_uuid=True), db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    resolution_note = db.Column(db.String(500), nullable=True)
    created_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    resolved_at = db.Column(db.DateTime(timezone=True), nullable=True)
