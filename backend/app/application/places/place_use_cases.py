# Casos de uso de THERS Places (ADR-040-thers-places.md, fases 1 y 2).
# La validación de parámetros vive en `domain/places/validators.py` (lectura) y
# `write_validators.py` (escritura); aquí solo se orquesta. Nada de esto guarda la
# ubicación de quien consulta: `lat`/`lng` se usan para la consulta y se descartan
# (ADR-040 §4.4).

from app.application.media.attachments import discard_files, store_attachments
from app.application.places import place_presenter
from app.domain.places import kinds, validators, write_validators
from app.domain.pulse import place_pulse
from app.domain.visits import place_visits
from app.domain.places.exceptions import (
    InvalidPlaceDataError,
    InvalidPlaceQueryError,
    PlaceNotFoundError,
    PlaceReportAlreadyResolvedError,
    PlaceReportNotFoundError,
    PlaceReviewNotFoundError,
    ReviewImageNotFoundError,
    TooManyReviewImagesError,
)


def _validated_category(category_raw, repository):
    slug = validators.parse_category_slug(category_raw)
    if slug is not None and not repository.category_exists(slug):
        raise InvalidPlaceQueryError("Categoría inválida")
    return slug


def _present_all(rows):
    return [place_presenter.present_summary(row) for row in rows]


# --------------------------------------------------------------------- lectura


def list_categories(repository):
    return [place_presenter.present_category(row) for row in repository.list_categories()]


def list_places(category_raw, limit_raw, offset_raw, repository, user_id=None):
    category = _validated_category(category_raw, repository)
    limit = validators.parse_limit(limit_raw)
    offset = validators.parse_offset(offset_raw)
    return _present_all(repository.list_places(category, limit, offset, user_id))


def nearby_places(lat_raw, lng_raw, radius_raw, category_raw, limit_raw, repository, user_id=None):
    lat, lng = validators.parse_coordinates(lat_raw, lng_raw)
    radius = validators.parse_radius(radius_raw)
    category = _validated_category(category_raw, repository)
    limit = validators.parse_limit(limit_raw)
    return _present_all(repository.nearby(lat, lng, radius, category, limit, user_id))


def search_places(q_raw, lat_raw, lng_raw, category_raw, limit_raw, repository, user_id=None):
    query = write_validators.parse_search_query(q_raw)
    # El origen es opcional, pero si llega uno de los dos deben llegar ambos.
    has_origin = (lat_raw not in (None, "")) or (lng_raw not in (None, ""))
    lat = lng = None
    if has_origin:
        lat, lng = validators.parse_coordinates(lat_raw, lng_raw)
    category = _validated_category(category_raw, repository)
    limit = validators.parse_limit(limit_raw)
    return _present_all(repository.search(query, lat, lng, category, limit, user_id))


def get_place(place_id, repository, user_id=None):
    row = repository.get_public_place(place_id, user_id)
    if row is None:
        raise PlaceNotFoundError()
    return place_presenter.present_detail(row)


def get_pulse(place_id, repository):
    """Nivel de actividad reciente del lugar (ADR-040 §32). Mismo 404 que la ficha."""
    if repository.get_public_place(place_id) is None:
        raise PlaceNotFoundError()
    return place_pulse.build_pulse(repository.pulse_counts(place_id, place_pulse.WINDOW_DAYS))


def record_visit(place_id, event_raw, user_id, repository):
    """Cuenta una visita anónima (ADR-040 §33). Mismo 404 que la ficha. No devuelve nada: la
    respuesta no dice si se contó o no (p. ej. si quien visita gestiona el lugar)."""
    event = place_visits.parse_event(event_raw)
    if repository.get_public_place(place_id) is None:
        raise PlaceNotFoundError()
    repository.record_visit(place_id, event, user_id)


# ------------------------------------------------------------------- guardados


def save_place(user_id, place_id, repository):
    """Idempotente. Solo se puede guardar un lugar público."""
    if repository.get_public_place(place_id) is None:
        raise PlaceNotFoundError()
    repository.save_place(user_id, place_id)
    return {"saved": True}


def unsave_place(user_id, place_id, repository):
    """Idempotente. Se puede quitar de guardados aunque el lugar ya no sea público,
    pero un lugar que no existe da 404."""
    if not repository.place_exists(place_id):
        raise PlaceNotFoundError()
    repository.unsave_place(user_id, place_id)
    return {"saved": False}


def list_saved(user_id, limit_raw, offset_raw, repository):
    limit = validators.parse_limit(limit_raw)
    offset = validators.parse_offset(offset_raw)
    return _present_all(repository.list_saved(user_id, limit, offset))


# -------------------------------------------------------------------- reportes


def report_place(user_id, place_id, reason, details, repository):
    """Devuelve `(reporte, creado)`. Solo se reporta un lugar público."""
    reason, details = write_validators.parse_report(reason, details)
    if repository.get_public_place(place_id) is None:
        raise PlaceNotFoundError()
    row, created = repository.create_report(place_id, user_id, reason, details)
    return place_presenter.present_own_report(row), created


# --------------------------------------------------------------------- reseñas


def write_review(user_id, place_id, rating, body, repository):
    """`(reseña, creada)`. Solo se reseña un lugar público; una por persona y lugar."""
    rating, body = write_validators.parse_review(rating, body)
    if repository.get_public_place(place_id) is None:
        raise PlaceNotFoundError()
    row, created = repository.upsert_review(user_id, place_id, rating, body)
    images = repository.review_images([row["id"]]).get(str(row["id"]), [])
    return place_presenter.present_own_review(row, images), created


def delete_review(user_id, place_id, repository, storage=None):
    if not repository.place_exists(place_id):
        raise PlaceNotFoundError()
    keys = repository.delete_review(user_id, place_id)
    if keys is None:
        raise PlaceReviewNotFoundError()
    # Ya con el borrado confirmado en la base: los archivos se limpian sin poder fallar.
    if storage is not None:
        discard_files(keys, storage)
    return {"deleted": True}


def add_review_images(user_id, place_id, prepared, repository, storage):
    """Añade fotos (ya procesadas: sin EXIF, WebP) a la reseña propia. Máximo
    `MAX_REVIEW_IMAGES` por reseña."""
    if not prepared:
        raise InvalidPlaceDataError("Adjunta al menos una imagen")
    if len(prepared) > kinds.MAX_REVIEW_IMAGES:
        raise TooManyReviewImagesError(kinds.MAX_REVIEW_IMAGES)
    if repository.get_public_place(place_id) is None:
        raise PlaceNotFoundError()
    stored = store_attachments(prepared, "review", storage)
    try:
        result = repository.add_review_images(user_id, place_id, stored, kinds.MAX_REVIEW_IMAGES)
    except Exception:
        discard_files([item["key"] for item in stored], storage)
        raise
    if result in ("no_review", "too_many"):
        discard_files([item["key"] for item in stored], storage)
        if result == "no_review":
            raise PlaceReviewNotFoundError()
        raise TooManyReviewImagesError(kinds.MAX_REVIEW_IMAGES)
    return place_presenter.present_images(result)


def delete_review_image(user_id, place_id, image_id, repository, storage):
    key = repository.delete_review_image(user_id, place_id, image_id)
    if key is None:
        raise ReviewImageNotFoundError()
    discard_files([key], storage)
    return {"deleted": True}


def list_reviews(place_id, limit_raw, offset_raw, repository, viewer_id=None):
    if repository.get_public_place(place_id) is None:
        raise PlaceNotFoundError()
    limit = validators.parse_limit(limit_raw)
    offset = validators.parse_offset(offset_raw)
    # Se pide una fila de más para saber si hay otra página.
    rows = repository.list_reviews(place_id, viewer_id, limit + 1, offset)[:limit + 1]
    images = repository.review_images([r["id"] for r in rows[:limit]])
    rows = [{**r, "images": images.get(str(r["id"]), [])} for r in rows]
    summary = repository.review_summary(place_id)
    return {
        "reviews": [place_presenter.present_review(r) for r in rows[:limit]],
        "has_more": len(rows) > limit,
        "summary": {
            "average": None if summary["average"] is None else float(summary["average"]),
            "count": int(summary["count"]),
        },
    }


# ------------------------------------------------------------------ moderación


def _status_filter(status_raw, allowed, default=None):
    if status_raw is None or str(status_raw).strip() == "":
        return default
    if status_raw not in allowed:
        raise InvalidPlaceQueryError("status inválido")
    return status_raw


def moderation_list_reports(status_raw, limit_raw, offset_raw, repository):
    status = _status_filter(status_raw, kinds.REPORT_STATUSES, default=kinds.REPORT_OPEN)
    limit = validators.parse_limit(limit_raw)
    offset = validators.parse_offset(offset_raw)
    # Se pide una fila de más para saber si hay otra página.
    rows = repository.list_place_reports(status, limit + 1, offset)
    return (
        [place_presenter.present_moderation_report(r) for r in rows[:limit]],
        len(rows) > limit,
    )


def moderation_resolve_report(moderator_id, report_id, status, note, repository):
    status, note = write_validators.parse_resolution(status, note)
    result = repository.resolve_place_report(moderator_id, report_id, status, note)
    if result == "not_found":
        raise PlaceReportNotFoundError()
    if result == "already_resolved":
        raise PlaceReportAlreadyResolvedError()
    return place_presenter.present_resolved_report(result)


def moderation_list_places(status_raw, q_raw, limit_raw, offset_raw, repository):
    status = _status_filter(status_raw, kinds.VERIFICATION_STATUSES)
    query = None
    if q_raw is not None and str(q_raw).strip():
        query = write_validators.parse_search_query(q_raw)
    limit = validators.parse_limit(limit_raw)
    offset = validators.parse_offset(offset_raw)
    rows = repository.list_places_admin(status, query, limit + 1, offset)
    return [place_presenter.present_admin(r) for r in rows[:limit]], len(rows) > limit


def moderation_get_place(place_id, repository):
    row = repository.get_place_admin(place_id)
    if row is None:
        raise PlaceNotFoundError()
    return place_presenter.present_admin(row)


def moderation_create_place(actor_id, data, repository):
    clean = write_validators.validate_new_place(data)
    category_id = repository.category_id(clean["category"])
    if category_id is None:
        raise InvalidPlaceDataError("Categoría inválida")
    place_id = repository.create_place(
        actor_id, write_validators.slugify(clean["name"]), category_id, clean
    )
    return place_presenter.present_admin(repository.get_place_admin(place_id))


def moderation_update_place(actor_id, place_id, data, repository):
    changes = write_validators.validate_place_update(data)
    category_id = None
    if "category" in changes:
        category_id = repository.category_id(changes["category"])
        if category_id is None:
            raise InvalidPlaceDataError("Categoría inválida")
    if not repository.update_place(actor_id, place_id, changes, category_id):
        raise PlaceNotFoundError()
    return place_presenter.present_admin(repository.get_place_admin(place_id))


def moderation_set_status(actor_id, place_id, data, repository):
    changes = write_validators.validate_status_change(data)
    if not repository.set_place_status(actor_id, place_id, changes):
        raise PlaceNotFoundError()
    return place_presenter.present_admin(repository.get_place_admin(place_id))


def moderation_summary(repository):
    return repository.summary()


def moderation_set_review_hidden(actor_id, review_id, data, repository):
    hidden, note = write_validators.parse_review_moderation(data.get("hidden"), data.get("note"))
    if not repository.set_review_hidden(actor_id, review_id, hidden, note):
        raise PlaceReviewNotFoundError()
    return {"review_id": str(review_id), "hidden": hidden}
