# Puertos del dominio de reportes (ADR-032). Interfaces puras: la
# implementación con SQLAlchemy vive en `infrastructure/persistence/repositories`.

from abc import ABC, abstractmethod
from dataclasses import dataclass

from app.domain.reports import kinds


@dataclass(frozen=True)
class ResolvedTarget:
    """Qué se está reportando, ya localizado.

    `owner_id`: autor del contenido, o la cuenta misma si el objetivo es un
    usuario. `post`: el post que da el contexto de visibilidad (el propio post,
    o el post del comentario); `None` para mensajes y usuarios. `recipient_id`:
    solo para mensajes. `text`: lo que se copia en `content_snapshot`.
    """

    target_type: str
    target_id: str
    owner_id: str
    text: str
    post: object = None
    recipient_id: str = None
    # Solo para mensajes de un grupo (ADR-048): ids de quienes están en él. Pueden reportarlo todos
    # menos quien lo escribió.
    group_member_ids: tuple = None


class ReportTargetResolver(ABC):
    @abstractmethod
    def resolve(self, target_type, target_id):
        """Devuelve un `ResolvedTarget`, o `None` si no existe. NO decide la
        visibilidad: eso es del caso de uso, que ya conoce las guardias."""


class ReportRepository(ABC):
    @abstractmethod
    def create_if_absent(
        self, reporter_id, target_type, target_id, reported_user_id, reason, details, snapshot,
        priority=kinds.PRIORITY_NORMAL,
    ):
        """Crea el reporte, o devuelve el que ya existía para
        (`reporter_id`, `target_type`, `target_id`). Devuelve `(reporte,
        creado)`. Idempotente: reportar dos veces lo mismo no duplica (índice
        único, ADR-032 §1), y es seguro frente a dos peticiones simultáneas.

        **Escalada (ADR-038):** si ya existía y el nuevo reporte es MÁS urgente (por
        ejemplo, se reportó como spam y ahora como explotación de menores), el reporte
        existente se eleva (motivo, prioridad, detalle) y se reabre si estaba cerrado como
        descartado. Sin esto, el índice único haría perder la prioridad. **Nunca se
        degrada:** un reporte posterior menos urgente no cambia el existente."""
