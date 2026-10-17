# Puerto (interfaz) del repositorio de planes con amistades (ADR-040 fase 5). Sin SQLAlchemy
# ni Flask: application/ lo consume y la infraestructura lo implementa.

from abc import ABC, abstractmethod


class PlanRepository(ABC):
    @abstractmethod
    def public_place_exists(self, place_id):
        """True si el lugar existe y es público (activo y verificado)."""

    @abstractmethod
    def friends_among(self, user_id, candidate_ids):
        """Subconjunto (set de str) de `candidate_ids` que son amistades de `user_id`: se
        siguen mutuamente (follows aceptados) y no hay bloqueo en ningún sentido."""

    @abstractmethod
    def create_plan(self, creator_id, place_id, title, note, starts_at, invitee_ids):
        """Crea el plan, la fila de quien lo crea (`going`) y las invitaciones, todo en una
        transacción. Devuelve el id del plan."""

    @abstractmethod
    def get_plan(self, plan_id, viewer_id):
        """Fila del plan SOLO si `viewer_id` es integrante; si no, None. Incluye
        `my_status`."""

    @abstractmethod
    def list_plans(self, viewer_id, scope, limit):
        """Planes de los que `viewer_id` es integrante, próximos o pasados."""

    @abstractmethod
    def members_of(self, plan_ids, viewer_id):
        """`{plan_id: [integrantes]}`, sin las cuentas bloqueadas con `viewer_id`."""

    @abstractmethod
    def update_plan(self, plan_id, creator_id, fields):
        """Edita un plan ACTIVO de `creator_id`. True si se modificó."""

    @abstractmethod
    def cancel_plan(self, plan_id, creator_id):
        """Cancela un plan ACTIVO de `creator_id`. True si se canceló."""

    @abstractmethod
    def add_invites(self, plan_id, inviter_id, invitee_ids, max_members):
        """Invita a `invitee_ids` (ya validadas como amistades). Devuelve `"full"` si se
        pasaría del tope, o la cantidad de invitaciones nuevas. Quien ya es integrante (o
        ya rechazó) no se reinvita."""

    @abstractmethod
    def respond(self, plan_id, user_id, status):
        """Cambia la respuesta de un integrante que NO es quien creó el plan. True si
        existía esa fila."""

    @abstractmethod
    def remove_member(self, plan_id, user_id):
        """Quita a un integrante que no es quien creó el plan. True si existía."""

    @abstractmethod
    def list_friends(self, user_id, limit):
        """Amistades de `user_id` (seguimiento mutuo aceptado, sin bloqueo), por nombre."""

    @abstractmethod
    def place_cards(self, place_ids):
        """`{id: fila}` de las tarjetas de los lugares PÚBLICOS de `place_ids`."""
