# POST /api/reports (ADR-032-content-reports-and-moderation.md §2).
#
# Fase 1: solo se puede REPORTAR. Las rutas de moderación (cola, resolver,
# suspender) son de la fase 2 y no existen todavía.

from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.application.rate_limiting import rate_limit_guard
from app.application.reports.report_use_cases import create_report
from app.domain.rate_limiting import policy
from app.domain.rate_limiting.exceptions import RateLimitExceededError
from app.domain.reports import kinds
from app.domain.reports.exceptions import (
    CannotReportSelfError,
    InvalidReportError,
    ReportTargetNotFoundError,
)
from app.infrastructure.persistence.repositories.domain_event_repository import (
    SQLAlchemyDomainEventRepository,
)
from app.infrastructure.persistence.repositories.follow_repository import (
    SQLAlchemyFollowRepository,
)
from app.infrastructure.persistence.repositories.rate_limit_repository import (
    SQLAlchemyRateLimitRepository,
)
from app.infrastructure.persistence.repositories.report_repository import (
    SQLAlchemyReportRepository,
)
from app.infrastructure.persistence.repositories.report_target_resolver import (
    SQLAlchemyReportTargetResolver,
)
from app.infrastructure.persistence.repositories.restriction_repository import (
    SQLAlchemyRestrictionRepository,
)
from app.interfaces.rate_limited_response import rate_limited_response

reports_bp = Blueprint("reports", __name__)

_report_repository = SQLAlchemyReportRepository()
_events = SQLAlchemyDomainEventRepository()
_target_resolver = SQLAlchemyReportTargetResolver()
_follow_repository = SQLAlchemyFollowRepository()
_restriction_repository = SQLAlchemyRestrictionRepository()
_rate_limit_repository = SQLAlchemyRateLimitRepository()


@reports_bp.route("/reports", methods=["POST"])
@jwt_required()
def post_report():
    reporter_id = get_jwt_identity()

    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"msg": "No se enviaron datos"}), 400

    # El límite va ANTES de cualquier trabajo: reportar en bucle es una forma de
    # saturar a quien modera. Por persona, no por IP: la cuenta es lo que se
    # protege (ADR-032 §2, regla `REPORT_CREATE` de ADR-027).
    try:
        # Un reporte de explotación de menores usa su propio límite, más holgado (ADR-038).
        rule = (
            policy.REPORT_CHILD_SAFETY
            if data.get("reason") == kinds.REASON_CHILD_SAFETY
            else policy.REPORT_CREATE
        )
        rate_limit_guard.enforce(rule, f"user:{reporter_id}", _rate_limit_repository)
    except RateLimitExceededError as error:
        return rate_limited_response(error)

    # Whitelist explícita: `reporter_id` sale SOLO del JWT, nunca del cuerpo, y
    # `status`, `reported_user_id` o cualquier otro campo del cuerpo se ignoran.
    try:
        report, created = create_report(
            reporter_id,
            data.get("target_type"),
            data.get("target_id"),
            data.get("reason"),
            data.get("details"),
            _target_resolver,
            _report_repository,
            _follow_repository,
            _restriction_repository,
        )
    except InvalidReportError as error:
        return jsonify({"msg": error.message}), 400
    except ReportTargetNotFoundError:
        # Un solo 404 para "no existe" y "no puedes verlo" (ADR-032 §2).
        return jsonify({"msg": "No encontramos lo que quieres reportar"}), 404
    except CannotReportSelfError:
        return jsonify({"msg": "No puedes reportar tu propio contenido ni tu cuenta"}), 400

    if created and report["priority"] == "critical":
        _notify_critical(report)

    # 201 si es nuevo; 200 si ya lo habías reportado (idempotente).
    return jsonify({"report": report}), 201 if created else 200


def _notify_critical(report):
    """Reporte crítico (ADR-038/ADR-044): aviso DIRECTO por correo desde Flask, sin depender de
    n8n, y un evento para n8n. Ningún fallo de esto puede romper el reporte ya guardado."""
    try:
        _events.enqueue("report.critical_created", {
            "report_id": report["id"], "target_type": report["target_type"],
            "reason": report["reason"],
        }, report["id"])
        _events.commit()
    except Exception:  # noqa: BLE001
        _events.rollback()
    alerter = current_app.extensions.get("team_alerter")
    if alerter is not None:
        alerter.alert("report_critical")
