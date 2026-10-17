# Puerto (interfaz) del repositorio de posts. Vive en domain/ porque es un
# contrato de negocio puro -- sin SQLAlchemy, sin Flask, sin PostgreSQL --
# que application/ consume y que infraestructura implementa (mismo patrón
# Repository que domain/auth/repositories.py ya estableció para `users`).

from abc import ABC, abstractmethod


class PostRepository(ABC):
    @abstractmethod
    def create(self, author_id, content, is_sensitive=False, place_id=None):
        """Crea un post y devuelve el registro creado (con `id`/`created_at`
        generados por PostgreSQL, y el autor ya resuelto). `is_sensitive` es lo
        que el autor declara (ADR-030-content-preferences.md)."""

    @abstractmethod
    def place_cards(self, place_ids):
        """Tarjeta mínima de cada lugar PÚBLICO de `place_ids`, por id (ADR-040 fase 4d)."""

    @abstractmethod
    def list_recent(self, limit, viewer_id, muted_keywords=(), place_id=None):
        """Devuelve los `limit` posts más recientes **visibles para
        `viewer_id`**, ordenados por `created_at` descendente, con el autor ya
        resuelto (sin N+1).

        Sigue siendo un feed global (no se filtra por a quién seguís --
        ADR-004 §Opciones consideradas, ADR-007 §No objetivos), pero desde
        ADR-022-private-accounts.md excluye los posts de cuentas privadas que
        `viewer_id` no sigue. Ese filtro va en el WHERE, no en Python: si se
        descartara después de traer la página, una página de 50 podría
        devolver 3 (ADR-022 §Decisión).

        Desde ADR-024-content-filters-and-privacy-preferences.md excluye
        además los posts cuyo texto contiene alguno de los `muted_keywords`
        del espectador -- por el mismo motivo va en el WHERE y no en Python.
        Nunca se le oculta a alguien su propio post."""

    @abstractmethod
    def get_by_id(self, post_id):
        """Devuelve el post con ese id, o None si no existe -- usado por
        `likes` (ADR-005) y `comments` (ADR-006) para devolver 404 sobre un
        post inexistente."""

    @abstractmethod
    def delete(self, post_id, author_id):
        """Borra el post `post_id` solo si su autor es `author_id`. Devuelve
        True si borró algo, False si no existía o era de otro autor -- la
        pertenencia se confirma en la misma operación que la existencia, no
        en un chequeo aparte (ADR-019-post-deletion.md, mismo criterio que
        MessageRepository.delete, ADR-014)."""

    @abstractmethod
    def update_content(self, post_id, author_id, content):
        """Reemplaza el texto del post `post_id` solo si su autor es
        `author_id`, y marca `edited_at`. Devuelve el post actualizado (con
        el autor ya resuelto), o None si no existía o era de otro autor --
        misma estrategia que delete(): la pertenencia se confirma en el
        propio WHERE, no en un chequeo aparte (ADR-021-content-editing.md).
        El `id` de la fila no cambia, así que likes y comentarios siguen
        apuntando al mismo post (ADR-021 §Consecuencias)."""
