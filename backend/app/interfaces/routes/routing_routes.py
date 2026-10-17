# Rutas hacia un lugar (ADR-040 fase 13). Exige sesión.
#
#   POST /api/places/<id>/route    cuerpo {from_lat, from_lng, profile: walk|bike|car, lang?, precision?}
#
# Es POST, aunque no cambia nada, para que la ubicación de la persona NO viaje en la query
# string: los registros de acceso del servidor y de los proxies guardan la URL completa
# (ADR-040 §4.4, R5) y no se debe quedar ahí. El destino sale de la base de datos; el origen
# se redondea en el servidor y no se guarda. La clave del proveedor nunca sale del servidor.

from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.application.rate_limiting import rate_limit_guard
from app.application.routing import route_use_cases
from app.domain.places.exceptions import InvalidPlaceQueryError, PlaceNotFoundError
from app.domain.rate_limiting import policy
from app.domain.rate_limiting.exceptions import RateLimitExceededError
from app.domain.routing.routing import RouteNotFoundError, RoutingUnavailableError
from app.infrastructure.persistence.repositories.place_repository import SQLAlchemyPlaceRepository
from app.infrastructure.persistence.repositories.rate_limit_repository import (
    SQLAlchemyRateLimitRepository,
)
from app.infrastructure.routing.factory import routing_state
from app.interfaces.rate_limited_response import rate_limited_response

routing_bp = Blueprint("routing", __name__)

_place_repository = SQLAlchemyPlaceRepository()
_rate_limit_repository = SQLAlchemyRateLimitRepository()


def _consume_budget():
    """Cupo diario GLOBAL del proveedor (compartido por todas las cuentas)."""
    rule = policy.routing_daily_rule(current_app.config.get("ROUTING_DAILY_BUDGET"))
    try:
        rate_limit_guard.enforce(rule, "global", _rate_limit_repository)
    except RateLimitExceededError:
        raise RoutingUnavailableError("cupo diario agotado") from None


@routing_bp.route("/places/<uuid:place_id>/route", methods=["POST"])
@jwt_required()
def get_route(place_id):
    data = request.get_json(silent=True)
    # Un recalculo de la navegación en vivo cuenta aparte de las rutas normales.
    rule = (
        policy.ROUTE_REROUTE
        if isinstance(data, dict) and data.get("precision") == "high"
        else policy.ROUTE_REQUEST
    )
    try:
        rate_limit_guard.enforce(rule, f"user:{get_jwt_identity()}", _rate_limit_repository)
    except RateLimitExceededError as error:
        return rate_limited_response(error)

    if not isinstance(data, dict):
        return jsonify({"msg": "No se enviaron datos"}), 400
    state = routing_state(current_app)
    try:
        route = route_use_cases.get_route(
            place_id, data, _place_repository, state["provider"], state["cache"], _consume_budget
        )
    except InvalidPlaceQueryError as error:
        return jsonify({"msg": error.message}), 400
    except PlaceNotFoundError:
        return jsonify({"msg": "Lugar no encontrado"}), 404
    except RouteNotFoundError:
        return jsonify({"msg": "No encontramos una ruta entre esos puntos"}), 422
    except RoutingUnavailableError:
        # Nunca el texto del proveedor: solo un mensaje fijo.
        return jsonify({"msg": "Las rutas no están disponibles ahora. Intentá más tarde."}), 503
    response = jsonify({"route": route})
    response.headers["Cache-Control"] = "no-store"
    return response, 200
