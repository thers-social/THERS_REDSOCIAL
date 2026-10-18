# Motor de políticas (ADR-044 §2.3). Función pura: señales + contexto -> decisión.
#
# Reglas que este módulo garantiza y que las pruebas fijan:
#   * NUNCA devuelve `rejected` ni una sanción: rechazar es de una persona.
#   * Ante cualquier duda (señal inutilizable, puntaje alto, reportes) NUNCA devuelve `approved`.
#   * Un puntaje de `child_safety` o `illegal` por encima del piso crítico es `critical`.

from app.domain.content_moderation import status

POLICY_VERSION = "p1"

PRIORITY_NORMAL = "normal"
PRIORITY_HIGH = "high"
PRIORITY_CRITICAL = "critical"

#: Categorías cuya señal, por baja que sea, no se aprueba sola y sube a `critical`.
CRITICAL_CATEGORIES = ("child_safety", "illegal")


class Thresholds:
    """Umbrales revisables (ADR-044: «un parámetro, no una verdad»). Se leen de la configuración."""

    __slots__ = (
        "doubt", "severe", "new_account_doubt", "new_account_days", "hold_all_new", "critical_floor",
    )

    def __init__(self, doubt=0.40, severe=0.85, new_account_doubt=0.10, new_account_days=7,
                 hold_all_new=False, critical_floor=0.10):
        self.doubt = doubt
        self.severe = severe
        self.new_account_doubt = new_account_doubt
        self.new_account_days = new_account_days
        self.hold_all_new = hold_all_new
        self.critical_floor = critical_floor


class Decision:
    __slots__ = ("status", "priority", "reason")

    def __init__(self, status, priority, reason):
        self.status = status
        self.priority = priority
        self.reason = reason


def decide(signal, account_age_days, open_reports, thresholds=None):
    """`signal`: `Signal` o None (sin clasificar). `account_age_days`: edad de la cuenta de quien
    publica. `open_reports`: reportes abiertos contra esa persona."""
    t = thresholds or Thresholds()
    is_new = account_age_days < t.new_account_days

    if signal is None or not signal.usable:
        return Decision(status.HELD, PRIORITY_NORMAL, "unclassified")

    if any(signal.scores.get(c, 0.0) >= t.critical_floor for c in CRITICAL_CATEGORIES):
        return Decision(status.HELD, PRIORITY_CRITICAL, "critical_category")
    if signal.top_score >= t.severe:
        return Decision(status.HELD, PRIORITY_CRITICAL, "severe_signal")
    if open_reports > 0:
        return Decision(status.HELD, PRIORITY_HIGH, "open_reports")
    if signal.top_score >= t.doubt:
        return Decision(status.HELD, PRIORITY_HIGH, "doubtful_signal")
    if is_new:
        # Cuentas nuevas (ADR-044 decisión 3): controles reforzados. Por defecto un umbral de
        # duda más bajo; `hold_all_new` retiene todo lo de una cuenta nueva (decisión del Comité).
        if t.hold_all_new:
            return Decision(status.HELD, PRIORITY_NORMAL, "new_account")
        if signal.top_score >= t.new_account_doubt:
            return Decision(status.HELD, PRIORITY_NORMAL, "new_account_low_doubt")
    return Decision(status.APPROVED, PRIORITY_NORMAL, "clean")
