# Excepciones de dominio para `places` (ADR-040-thers-places.md).


class InvalidPlaceQueryError(Exception):
    """Un parámetro de consulta (lat, lng, radius, limit, category...) falta o
    no es válido. `message` es un texto listo para devolver en `{"msg": ...}`."""

    def __init__(self, message):
        super().__init__(message)
        self.message = message


class PlaceNotFoundError(Exception):
    """El lugar no existe, está inactivo o no es público. Los tres casos se
    tratan igual (404, sin distinguir cuál ocurrió), mismo criterio que
    ADR-019/ADR-020/ADR-032."""


class InvalidPlaceDataError(Exception):
    """Un dato que se intenta ESCRIBIR (crear/editar un lugar, reportar, resolver)
    no es válido. `message` va tal cual en `{"msg": ...}` con 400."""

    def __init__(self, message):
        super().__init__(message)
        self.message = message


class PlaceReportNotFoundError(Exception):
    """El reporte de lugar no existe."""


class PlaceReportAlreadyResolvedError(Exception):
    """El reporte ya estaba cerrado (resuelto o descartado): no se puede cerrar dos veces."""
