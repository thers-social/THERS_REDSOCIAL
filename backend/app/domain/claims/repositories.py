# Puerto (interfaz) del repositorio de reclamos de negocio (ADR-040 fase 6). Sin SQLAlchemy
# ni Flask.

from abc import ABC, abstractmethod


class ClaimRepository(ABC):
    @abstractmethod
    def public_place_exists(self, place_id):
        """True si el lugar existe y es público (activo y verificado)."""

    @abstractmethod
    def is_manager(self, place_id, user_id):
        """True si `user_id` gestiona `place_id`."""

    @abstractmethod
    def place_has_manager(self, place_id):
        """True si el lugar ya tiene alguna persona gestora."""

    @abstractmethod
    def count_pending(self, user_id):
        """Reclamos pendientes de la persona."""

    @abstractmethod
    def create_claim(self, place_id, claimant_id, business_name, contact_phone, message,
                     document_key, document_content_type):
        """Crea el reclamo pendiente y devuelve su id; None si ya había uno pendiente."""

    @abstractmethod
    def list_for_claimant(self, claimant_id, limit):
        """Reclamos de la persona, recientes primero."""

    @abstractmethod
    def get_claim(self, claim_id):
        """Fila del reclamo (sin comprobar permiso) o None."""

    @abstractmethod
    def withdraw(self, claim_id, claimant_id):
        """Pasa a `withdrawn` un reclamo PENDIENTE de la persona y suelta el documento.
        Devuelve la clave del documento que había (o None) si cambió; False si no."""

    @abstractmethod
    def list_for_review(self, status, limit, offset):
        """Reclamos para moderación (sin documento), antiguos primero si están pendientes."""

    @abstractmethod
    def get_for_review(self, claim_id):
        """Como `list_for_review` pero de un solo reclamo, o None."""

    @abstractmethod
    def decide(self, claim_id, reviewer_id, approve, note):
        """Resuelve un reclamo PENDIENTE. Aprobar crea la fila de gestor y rechaza el resto de
        pendientes del lugar, todo con auditoría en la misma transacción. Devuelve
        `{"claim": fila, "released_keys": [...]}` o None si ya no estaba pendiente."""

    @abstractmethod
    def record_document_view(self, claim_id, reviewer_id):
        """Deja en la auditoría que se pidió la URL del documento."""

    @abstractmethod
    def place_cards(self, place_ids):
        """`{place_id: tarjeta}` de los lugares."""
