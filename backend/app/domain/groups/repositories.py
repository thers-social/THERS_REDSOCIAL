# Puerto del repositorio de chats grupales (ADR-048). Sin SQLAlchemy ni Flask.

from abc import ABC, abstractmethod


class GroupRepository(ABC):
    @abstractmethod
    def create(self, name, creator_id, member_ids):
        """Crea el grupo con `creator_id` como administrador y `member_ids` como miembros."""

    @abstractmethod
    def get(self, group_id):
        """El grupo, o None."""

    @abstractmethod
    def membership(self, group_id, user_id):
        """La fila de pertenencia de `user_id` (con `.role`, `.last_read_at`), o None si no es miembro."""

    @abstractmethod
    def members(self, group_id):
        """Todas las pertenencias del grupo con el usuario resuelto, la más antigua primero."""

    @abstractmethod
    def add_members(self, group_id, user_ids):
        """Añade a `user_ids` (los que ya están se ignoran). Devuelve los realmente añadidos."""

    @abstractmethod
    def remove_member(self, group_id, user_id):
        """Quita a `user_id`. Devuelve True si era miembro."""

    @abstractmethod
    def set_role(self, group_id, user_id, role):
        """Cambia el rol de un miembro."""

    @abstractmethod
    def rename(self, group_id, name):
        """Cambia el nombre."""

    @abstractmethod
    def media_keys(self, group_id):
        """Claves de almacenamiento de los archivos (imágenes, voz, video y miniaturas) de los
        mensajes del grupo: hay que recogerlas ANTES de borrarlo, la cascada no toca los archivos."""

    @abstractmethod
    def delete(self, group_id):
        """Borra el grupo y todos sus mensajes."""

    @abstractmethod
    def list_for_user(self, user_id):
        """Grupos de `user_id`: para cada uno `{group, member_count, last_message, unread_count}`,
        el de actividad más reciente primero."""

    @abstractmethod
    def list_messages_page(self, group_id, limit, hidden_sender_ids, before=None, after=None):
        """Misma paginación que `MessageRepository.list_thread_page` (ADR-035), sobre el grupo y sin los
        mensajes de `hidden_sender_ids` (cuentas bloqueadas por quien mira o que lo bloquearon)."""

    @abstractmethod
    def mark_read(self, group_id, user_id):
        """`last_read_at` = ahora para ese miembro."""
