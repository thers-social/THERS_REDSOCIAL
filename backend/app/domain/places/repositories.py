# Puerto de persistencia de THERS Places (ADR-040-thers-places.md).
# Los repositorios devuelven diccionarios simples (no entidades del ORM) para que
# `application/` no dependa de SQLAlchemy (BACKEND_ARCHITECTURE.md §17).
#
# La lectura pública solo ve lugares activos y `verified`; los métodos `*_admin`
# (moderación) ven todos los estados.


class PlaceRepository:
    # --- catálogo público ---
    def list_categories(self):
        """Categorías activas, ordenadas por `sort_order` y nombre."""
        raise NotImplementedError

    def category_exists(self, slug):
        raise NotImplementedError

    def category_id(self, slug):
        """Id de una categoría activa, o `None`."""
        raise NotImplementedError

    def list_places(self, category_slug, limit, offset, user_id=None):
        """Lugares públicos, orden estable por nombre e id. Con `user_id`, calcula `is_saved`."""
        raise NotImplementedError

    def nearby(self, lat, lng, radius_meters, category_slug, limit, user_id=None):
        """Lugares públicos a `radius_meters` o menos, del más cercano al más lejano, con
        `distance_meters`. Se resuelve con el índice espacial."""
        raise NotImplementedError

    def search(self, query, lat, lng, category_slug, limit, user_id=None):
        """Búsqueda por nombre sin importar mayúsculas ni tildes. `distance_meters` solo
        si hay `lat`/`lng`."""
        raise NotImplementedError

    def get_public_place(self, place_id, user_id=None):
        """Un lugar público o `None`."""
        raise NotImplementedError

    def record_visit(self, place_id, event, user_id=None):
        """Suma 1 al contador anónimo del día local (ADR-040 §33). No cuenta si `user_id` gestiona
        el lugar. No guarda quién."""
        raise NotImplementedError

    def pulse_counts(self, place_id, window_days):
        """Conteos de actividad reciente por fuente (`reviews`, `saves`, `plans`, `posts`).
        Solo enteros: ningún identificador de persona (ADR-040 §32)."""
        raise NotImplementedError

    # --- guardados ---
    def place_exists(self, place_id):
        """True si el lugar existe en CUALQUIER estado."""
        raise NotImplementedError

    def save_place(self, user_id, place_id):
        """Idempotente. True si se guardó ahora."""
        raise NotImplementedError

    def unsave_place(self, user_id, place_id):
        """Idempotente. True si se quitó ahora."""
        raise NotImplementedError

    def list_saved(self, user_id, limit, offset):
        """Guardados de la persona que siguen siendo públicos, el más reciente primero."""
        raise NotImplementedError

    # --- reportes de datos incorrectos ---
    def create_report(self, place_id, reporter_id, reason, details):
        """`(reporte, creado)`. Idempotente sobre reportes abiertos iguales."""
        raise NotImplementedError

    def list_place_reports(self, status, limit, offset):
        raise NotImplementedError

    def resolve_place_report(self, moderator_id, report_id, status, note):
        """`"not_found"`, `"already_resolved"` o el reporte actualizado. Auditado."""
        raise NotImplementedError

    # --- administración (moderación) ---
    def list_places_admin(self, status, query, limit, offset):
        raise NotImplementedError

    def get_place_admin(self, place_id):
        raise NotImplementedError

    def create_place(self, actor_id, base_slug, category_id, data):
        raise NotImplementedError

    def update_place(self, actor_id, place_id, changes, category_id=None):
        """False si el lugar no existe."""
        raise NotImplementedError

    def set_place_status(self, actor_id, place_id, changes):
        """False si el lugar no existe."""
        raise NotImplementedError

    def summary(self):
        raise NotImplementedError

    # --- reseñas (fase 4a) ---
    def upsert_review(self, user_id, place_id, rating, body):
        """`(reseña, creada)`. Una por persona y lugar; si existe, se actualiza."""
        raise NotImplementedError

    def delete_review(self, user_id, place_id):
        """Claves de almacenamiento de sus fotos (lista, posiblemente vacía) si había
        reseña propia y se borró; `None` si no había."""
        raise NotImplementedError

    def review_images(self, review_ids):
        """`{review_id: [filas de foto]}` en orden de posición."""
        raise NotImplementedError

    def add_review_images(self, user_id, place_id, items, limit):
        """Añade fotos ya guardadas en el almacenamiento a la reseña propia. Devuelve
        `"no_review"`, `"too_many"` o la lista completa de fotos de la reseña."""
        raise NotImplementedError

    def delete_review_image(self, user_id, place_id, image_id):
        """Clave de almacenamiento de la foto borrada, o `None` si no era de esa reseña."""
        raise NotImplementedError

    def list_reviews(self, place_id, viewer_id, limit, offset):
        """Reseñas visibles (no ocultas por moderación) y sin bloqueos entre autor y
        `viewer_id`, la propia primero, luego la más reciente."""
        raise NotImplementedError

    def review_summary(self, place_id):
        """`{"average": float|None, "count": int}` sobre reseñas no ocultas."""
        raise NotImplementedError

    def set_review_hidden(self, actor_id, review_id, hidden, note):
        """False si la reseña no existe. Auditado en la misma transacción."""
        raise NotImplementedError
