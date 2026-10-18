# Puerto de persistencia de las publicaciones guardadas (ADR-047). Solo tipos nativos: domain/ no
# importa Flask ni SQLAlchemy (BACKEND_ARCHITECTURE.md §7/§17).


class SavedPostRepository:
    def add(self, user_id, post_id):
        """Guarda. Idempotente: devuelve `True` si lo creó y `False` si ya estaba guardada."""
        raise NotImplementedError

    def remove(self, user_id, post_id):
        raise NotImplementedError

    def saved_post_ids(self, user_id, post_ids):
        """El subconjunto de `post_ids` que `user_id` tiene guardado."""
        raise NotImplementedError
