# Casos de uso del panel de negocio (ADR-040 fase 7). Solo personas gestoras de UN lugar
# (`place_managers`, fase 6), no moderación. Quien no gestiona el lugar recibe el mismo 404 que
# si el lugar no existiera. Un gestor edita únicamente descripción, dirección, teléfono y
# sitio web: nombre, categoría, coordenadas y estado siguen siendo de moderación.

import re
from datetime import datetime, timezone

from app.application.places import place_presenter
from app.domain.analytics import place_analytics
from app.domain.quotes import quotes
from app.domain.notifications import place_events
from app.domain.places import kinds, write_validators
from app.domain.places.exceptions import (
    InvalidPlaceDataError,
    PlaceNotFoundError,
    PlaceReviewNotFoundError,
)

MAX_REPLY_LENGTH = 500
MANAGER_EDITABLE = ("description", "address", "phone", "website")
_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def _require_manager(place_id, user_id, repository, place_repository):
    if not repository.is_manager(place_id, user_id) or place_repository.get_public_place(place_id) is None:
        raise PlaceNotFoundError()


def _reply_body(value):
    if not isinstance(value, str) or not value.strip():
        raise InvalidPlaceDataError("body es obligatorio")
    value = value.strip()
    if _CONTROL_RE.search(value):
        raise InvalidPlaceDataError("body tiene caracteres no permitidos")
    if len(value) > MAX_REPLY_LENGTH:
        raise InvalidPlaceDataError(f"body no puede superar {MAX_REPLY_LENGTH} caracteres")
    return value


def list_managed(user_id, repository):
    rows = repository.list_managed(user_id)
    return [
        {
            "id": str(row["id"]),
            "name": row["name"],
            "municipality": row["municipality"],
            "department": row["department"],
            "category": {"slug": row["category_slug"], "name": row["category_name"]},
            "is_public": bool(row["is_active"]) and row["verification_status"] in kinds.PUBLIC_STATUSES,
            "rating_average": None if row["rating_average"] is None else float(row["rating_average"]),
            "reviews_count": int(row["reviews_count"]),
        }
        for row in rows
    ]


def get_panel(place_id, user_id, repository, place_repository):
    _require_manager(place_id, user_id, repository, place_repository)
    place = place_presenter.present_detail(place_repository.get_public_place(place_id, user_id))
    stats = repository.stats(place_id)
    return {
        "place": place,
        "stats": {
            "saves": int(stats["saves"]),
            "reviews": int(stats["reviews"]),
            "rating_average": None if stats["rating_average"] is None else float(stats["rating_average"]),
            "reviews_without_reply": int(stats["reviews_without_reply"]),
            "upcoming_plans": int(stats["upcoming_plans"]),
        },
    }


def _money(cents):
    return {"cents": cents, "amount": quotes.format_money(cents), "currency": quotes.CURRENCY}


def get_analytics(place_id, user_id, days_raw, repository, place_repository, now=None):
    """Estadísticas del lugar para quien lo gestiona (ADR-040 §31). Solo conteos agregados."""
    days = place_analytics.parse_days(days_raw)
    _require_manager(place_id, user_id, repository, place_repository)
    today = place_analytics.local_today(now or datetime.now(timezone.utc))
    bounds = place_analytics.period_bounds(today, days)
    data = repository.analytics_rows(place_id, bounds["previous"][0], bounds["current"][1])
    return place_analytics.build_report(data, today, days, _money)


def update_place(place_id, user_id, data, repository, place_repository):
    _require_manager(place_id, user_id, repository, place_repository)
    # Lista blanca: cualquier otro campo (name, category, latitude, status...) se ignora.
    allowed = {key: data[key] for key in MANAGER_EDITABLE if key in data}
    clean = write_validators.validate_place_update(allowed)
    place_repository.update_place(user_id, place_id, clean)
    return place_presenter.present_detail(place_repository.get_public_place(place_id, user_id))


def reply(place_id, review_id, user_id, body, repository, place_repository):
    _require_manager(place_id, user_id, repository, place_repository)
    body = _reply_body(body)
    if not repository.visible_review_exists(place_id, review_id):
        raise PlaceReviewNotFoundError()
    row = repository.upsert_reply(review_id, place_id, user_id, body)
    # Un solo aviso por reseña: editar la respuesta no vuelve a avisar (índice único).
    repository.notify_people(
        place_events.REVIEW_REPLY, place_id, review_id, [repository.review_author(review_id)], user_id
    )
    return {
        "body": row["body"],
        "created_at": row["created_at"].isoformat(),
        "updated_at": row["updated_at"].isoformat(),
    }


def delete_reply(place_id, review_id, user_id, repository, place_repository):
    _require_manager(place_id, user_id, repository, place_repository)
    if not repository.delete_reply(review_id, place_id):
        raise PlaceReviewNotFoundError()
    return {"deleted": True}
