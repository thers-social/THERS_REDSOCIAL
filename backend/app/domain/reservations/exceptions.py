# Excepciones de dominio de las reservas (ADR-040 fase 8).


class InvalidReservationDataError(Exception):
    """Un dato no es válido. `message` va tal cual en `{"msg": ...}` con 400."""

    def __init__(self, message):
        super().__init__(message)
        self.message = message


class ReservationNotFoundError(Exception):
    """No existe, o la persona no es parte de ella (404 sin distinguir)."""


class ReservationsClosedError(Exception):
    """El lugar no acepta reservas (409)."""


class SlotFullError(Exception):
    """No queda cupo en ese horario (409)."""


class ReservationConflictError(Exception):
    """Ya tiene esa reserva, o llegó al máximo de reservas activas (409)."""


class ReservationResolvedError(Exception):
    """La reserva ya no admite ese cambio por su estado o porque ya pasó (409)."""


class PlaceClosedAtThatTimeError(Exception):
    """El lugar está cerrado ese día o fuera de su horario (409)."""

    def __init__(self, reason):
        super().__init__(reason)
        self.reason = reason  # "closed_day" | "outside_hours"
