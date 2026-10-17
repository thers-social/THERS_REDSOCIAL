# Excepciones de dominio de los reclamos de negocio (ADR-040 fase 6).


class InvalidClaimDataError(Exception):
    """Un dato del reclamo no es válido. `message` va tal cual en `{"msg": ...}` con 400."""

    def __init__(self, message):
        super().__init__(message)
        self.message = message


class ClaimNotFoundError(Exception):
    """El reclamo no existe o no es de esta persona (404 sin distinguir)."""


class ClaimAlreadyResolvedError(Exception):
    """El reclamo ya no está pendiente (409)."""


class PlaceAlreadyManagedError(Exception):
    """La persona ya gestiona el lugar, o este ya tiene gestor (409)."""


class ClaimLimitError(Exception):
    """Ya tiene el máximo de reclamos pendientes, o ya tiene uno de este lugar (409)."""


class ClaimsUnavailableError(Exception):
    """No hay almacenamiento privado configurado (503)."""
