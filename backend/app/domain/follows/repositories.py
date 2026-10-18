# Puerto (interfaz) del repositorio de follows. Vive en domain/ porque es un
# contrato de negocio puro -- sin SQLAlchemy, sin Flask, sin PostgreSQL --
# que application/ consume y que infraestructura implementa (mismo patrón
# Repository que domain/likes/repositories.py y domain/comments/repositories.py
# ya establecieron).

from abc import ABC, abstractmethod


class FollowRepository(ABC):
    @abstractmethod
    def add(self, follower_id, followed_id, status):
        """Registra que `follower_id` sigue a `followed_id` con ese `status`
        (domain/follows/follow_status.py). Idempotente: si la fila ya existía
        (UNIQUE (follower_id, followed_id)), no falla ni duplica ni le pisa
        el estado -- pedir dos veces no reabre una solicitud ya aceptada, y
        un POST repetido sobre un follow ya hecho no lo degrada a 'pending'
        (ADR-007 §Decisión, extendido por ADR-022-private-accounts.md).
        Devuelve True si la fila se creó en esta llamada, False si ya
        existía -- ADR-008-notifications-minimal-model.md lo usa para no
        notificar en una repetición idempotente."""

    @abstractmethod
    def remove(self, follower_id, followed_id):
        """Deja de seguir. Idempotente: si no existía, no falla."""

    @abstractmethod
    def is_following(self, follower_id, followed_id):
        """True si `follower_id` sigue a `followed_id` con un follow
        **aceptado**. Una solicitud en 'pending' devuelve False: pedir no es
        seguir (ADR-022 §Decisión)."""

    @abstractmethod
    def get_status(self, follower_id, followed_id):
        """Estado del follow de `follower_id` hacia `followed_id`
        ('accepted'/'pending'), o None si no hay ninguna fila. Permite al
        Frontend distinguir los tres estados del botón (Seguir / Solicitado /
        Siguiendo) sin inferirlos (ADR-022 §Contrato API)."""

    @abstractmethod
    def set_status(self, follower_id, followed_id, status):
        """Cambia el estado de un follow existente. Devuelve True si había una
        fila que actualizar, False si no -- el caso de uso traduce False a 404
        sin distinguir "no existe" de "no es tuya", mismo criterio que el
        resto de endpoints sobre recursos propios (ADR-022 §Seguridad)."""

    @abstractmethod
    def remove_pending(self, follower_id, followed_id):
        """Borra la solicitud **pendiente** de `follower_id` hacia
        `followed_id`. Devuelve True si borró algo, False si no había
        ninguna pendiente. Rechazar borra la fila en vez de marcarla: la
        persona puede volver a pedirlo y no queda registro de un "no"
        (ADR-022 §Opciones consideradas). A diferencia de `remove()`, nunca
        toca un follow ya aceptado -- rechazar no puede desaparecer a un
        seguidor que ya lo era."""

    @abstractmethod
    def list_pending_requests(self, followed_id, limit):
        """Solicitudes de seguimiento sin responder dirigidas a `followed_id`,
        más recientes primero, con el solicitante ya resuelto (sin N+1).
        Siempre desde la perspectiva del usuario autenticado -- nadie puede
        listar las solicitudes de otro (ADR-022 §Seguridad)."""

    @abstractmethod
    def pending_requests_count(self, followed_id):
        """Cuántas solicitudes sin responder tiene `followed_id` -- alimenta
        el badge del Frontend sin traerse la lista entera."""

    @abstractmethod
    def followers_count(self, user_id):
        """Cantidad de usuarios que siguen a `user_id` con un follow
        **aceptado** -- las solicitudes pendientes no cuentan como seguidores
        (ADR-022 §Decisión)."""

    @abstractmethod
    def following_count(self, user_id):
        """Cantidad de usuarios que `user_id` sigue, solo los **aceptados**
        -- mismo criterio que followers_count."""

    @abstractmethod
    def follow_statuses(self, follower_id, candidate_ids):
        """Devuelve `{followed_id: status}` para los `candidate_ids` con los
        que `follower_id` tiene alguna fila de follow -- los que no aparecen
        en el dict no tienen ninguna relación. Evita N+1 al resolver
        `is_followed_by_me`/`follow_status` en GET /api/posts, mismo patrón
        que LikeRepository.liked_post_ids.

        Reemplaza a `followed_user_ids` (ADR-007), que solo sabía decir
        sí/no: con cuentas privadas el Frontend necesita distinguir tres
        estados del botón -- Seguir, Solicitado, Siguiendo -- y resolverlos
        con dos consultas (una por estado) sería un N+1 evitable
        (ADR-022 §Contrato API)."""

    @abstractmethod
    def list_followers(self, user_id, limit, offset):
        """Los `User` que siguen a `user_id` con un follow **aceptado**, el más reciente primero."""

    @abstractmethod
    def list_following(self, user_id, limit, offset):
        """Los `User` a quienes `user_id` sigue (follow **aceptado**), el más reciente primero."""
