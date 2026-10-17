# Excepciones de dominio de los planes con amistades (ADR-040 fase 5).


class InvalidPlanDataError(Exception):
    """Un dato del plan no es válido. `message` va tal cual en `{"msg": ...}` con 400."""

    def __init__(self, message):
        super().__init__(message)
        self.message = message


class PlanNotFoundError(Exception):
    """El plan no existe o la persona no es integrante (404 sin distinguir)."""


class PlanForbiddenError(Exception):
    """Es integrante, pero la acción es solo de quien creó el plan (403)."""


class PlanClosedError(Exception):
    """El plan está cancelado o ya pasó: no admite cambios, invitaciones ni respuestas (409)."""


class PlanFullError(Exception):
    """El plan llegaría a más integrantes de los permitidos (409)."""


class NotFriendsError(Exception):
    """Alguna persona a invitar no es una amistad (se siguen mutuamente, sin bloqueo). Un
    solo mensaje para inexistente, no amistad o bloqueada: no revela cuál ocurrió."""
