# Reglas de la lista de mejores amigos (ADR-054). Solo tipos nativos: domain/ no importa Flask ni
# SQLAlchemy (BACKEND_ARCHITECTURE.md §7/§17).

#: Tope de personas en la lista. Evita una lista sin fondo y una consulta de lectura cada vez más cara.
MAX_CLOSE_FRIENDS = 500


class CloseFriendTargetNotFoundError(Exception):
    """La persona no existe, está bloqueada (en cualquier sentido) o es uno mismo: el mismo 404 para
    no revelar cuál de las tres. Una cuenta bloqueada tampoco puede entrar en la lista."""


class CloseFriendsLimitError(Exception):
    """La lista ya tiene `MAX_CLOSE_FRIENDS` personas."""


class CloseFriendRepository:
    """Puerto de persistencia de la lista de mejores amigos."""

    def list_for(self, owner_id, limit):
        """Personas de la lista de `owner_id` (con nombre y foto), de la más reciente a la más antigua."""
        raise NotImplementedError

    def count(self, owner_id):
        raise NotImplementedError

    def add(self, owner_id, friend_id):
        """Idempotente: `True` solo si era nueva."""
        raise NotImplementedError

    def remove(self, owner_id, friend_id):
        """Idempotente: `True` solo si estaba."""
        raise NotImplementedError

    def is_member(self, owner_id, friend_id):
        """¿`friend_id` está en la lista de `owner_id`? Es lo que decide ver una publicación o una
        historia solo para mejores amigos (ADR-054)."""
        raise NotImplementedError

    def member_ids(self, owner_id):
        """Conjunto (de str) de los ids de la lista de `owner_id`."""
        raise NotImplementedError

    def can_add(self, owner_id, friend_id):
        """¿La persona existe, no es `owner_id` y no hay bloqueo entre ambos?"""
        raise NotImplementedError
