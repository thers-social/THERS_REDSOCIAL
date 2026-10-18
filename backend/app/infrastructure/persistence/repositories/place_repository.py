# Adaptador SQLAlchemy del puerto `PlaceRepository` (domain/places/repositories.py).
# Único punto del backend que habla SQL espacial (`ST_*`) de PostGIS -- domain/ y
# application/ no importan SQLAlchemy (BACKEND_ARCHITECTURE.md §17).
#
# Todos los valores van como parámetros ligados, nunca concatenados en el SQL. Los
# únicos fragmentos construidos dinámicamente (nombres de columna en `update_place`)
# salen de un diccionario fijo de este módulo, jamás de la petición.
#
# Lectura pública: solo lugares activos y con `verification_status` 'verified' o 'unverified'
# (ADR-043: los importados de OpenStreetMap se ven, con la etiqueta «sin verificar»).
# Las rutas de moderación (`*_admin`) ven todos los estados.

import json
import secrets

from flask import current_app
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.domain.content_moderation import jobs as moderation_jobs
from app.domain.content_moderation.status import initial_status
from app.domain.places import kinds
from app.domain.places.repositories import PlaceRepository
from app.extensions import db

_PUBLIC = "p.is_active AND p.verification_status IN ('verified', 'unverified') AND c.is_active"
_LIKE_ESCAPE = "!"

# `geography` -> `geometry` para extraer longitud/latitud con ST_X/ST_Y.
_BASE_COLUMNS = """
    p.id, p.name, p.slug, p.description, p.address, p.municipality, p.department,
    p.phone, p.website, p.verification_status, p.source, p.coordinate_source,
    p.last_verified_at, p.image_key,
    ST_Y(p.location::geometry) AS latitude, ST_X(p.location::geometry) AS longitude,
    c.id AS category_id, c.slug AS category_slug, c.name AS category_name,
    (SELECT round(avg(rv.rating), 1) FROM place_reviews rv
        WHERE rv.place_id = p.id AND NOT rv.is_hidden) AS rating_average,
    (SELECT count(*) FROM place_reviews rv
        WHERE rv.place_id = p.id AND NOT rv.is_hidden) AS reviews_count
"""

_ADMIN_EXTRA = """,
    p.is_active, p.created_by_user_id, p.verified_by_user_id, p.created_at, p.updated_at
"""

_FROM = "FROM places p JOIN place_categories c ON c.id = p.category_id"

# Columnas editables de `places` (clave de la petición -> columna). Lista cerrada.
_EDITABLE_COLUMNS = {
    "name": "name",
    "description": "description",
    "address": "address",
    "municipality": "municipality",
    "department": "department",
    "phone": "phone",
    "website": "website",
    "source": "source",
    "coordinate_source": "coordinate_source",
}


def _columns(user_id):
    """Columnas del resumen/detalle, con `is_saved` calculado para `user_id` (o falso)."""
    if user_id is None:
        return _BASE_COLUMNS + ", false AS is_saved"
    return _BASE_COLUMNS + (
        ", EXISTS (SELECT 1 FROM saved_places s "
        "WHERE s.place_id = p.id AND s.user_id = :uid) AS is_saved"
    )


def _claim_columns(user_id):
    """`is_claimed` (alguien gestiona el lugar) y `managed_by_me`, solo en el detalle."""
    mine = (
        "EXISTS (SELECT 1 FROM place_managers pm WHERE pm.place_id = p.id AND pm.user_id = :uid)"
        if user_id is not None
        else "false"
    )
    return (
        "EXISTS (SELECT 1 FROM place_managers pm WHERE pm.place_id = p.id) AS is_claimed, "
        "NOT EXISTS (SELECT 1 FROM place_reservation_settings rs WHERE rs.place_id = p.id "
        "AND NOT rs.enabled) AS accepts_reservations, "
        f"{mine} AS managed_by_me"
    )


def _uid(user_id):
    return {} if user_id is None else {"uid": str(user_id)}


def _like_pattern(query):
    """`%consulta%` con los comodines de LIKE neutralizados (escape `!`)."""
    escaped = (
        query.replace(_LIKE_ESCAPE, _LIKE_ESCAPE * 2).replace("%", "!%").replace("_", "!_")
    )
    return f"%{escaped}%"


class SQLAlchemyPlaceRepository(PlaceRepository):
    # ------------------------------------------------------------------ catálogo

    def list_categories(self):
        rows = db.session.execute(
            text(
                "SELECT id, slug, name FROM place_categories "
                "WHERE is_active ORDER BY sort_order, name"
            )
        ).mappings()
        return [dict(row) for row in rows]

    def category_exists(self, slug):
        return self.category_id(slug) is not None

    def category_id(self, slug):
        return db.session.execute(
            text("SELECT id FROM place_categories WHERE slug = :slug AND is_active"),
            {"slug": slug},
        ).scalar()

    def list_places(self, category_slug, limit, offset, user_id=None):
        rows = db.session.execute(
            text(
                f"SELECT {_columns(user_id)} {_FROM} "
                f"WHERE {_PUBLIC} AND (CAST(:category AS text) IS NULL OR c.slug = :category) "
                "ORDER BY p.name, p.id LIMIT :limit OFFSET :offset"
            ),
            {"category": category_slug, "limit": limit, "offset": offset, **_uid(user_id)},
        ).mappings()
        return [dict(row) for row in rows]

    def top_places(self, category_slug, limit, user_id=None):
        """Los mejor valorados (promedio de reseñas visibles, luego cantidad de reseñas); a igualdad,
        los que ya tienen imagen y, al final, por nombre. Sin ubicación de nadie (ADR-053)."""
        rows = db.session.execute(
            text(
                f"SELECT {_columns(user_id)} {_FROM} "
                f"WHERE {_PUBLIC} AND (CAST(:category AS text) IS NULL OR c.slug = :category) "
                "ORDER BY rating_average DESC NULLS LAST, reviews_count DESC, "
                "(p.image_key IS NULL), p.name, p.id LIMIT :limit"
            ),
            {"category": category_slug, "limit": limit, **_uid(user_id)},
        ).mappings()
        return [dict(row) for row in rows]

    def nearby(self, lat, lng, radius_meters, category_slug, limit, user_id=None):
        # ST_DWithin filtra con el índice GiST; `<->` ordena por cercanía. La distancia
        # exacta se calcula solo para las filas ya filtradas. Nunca se itera en Python.
        rows = db.session.execute(
            text(
                f"SELECT {_columns(user_id)}, "
                "ST_Distance(p.location, pt.geog) AS distance_meters "
                "FROM places p "
                "JOIN place_categories c ON c.id = p.category_id, "
                "LATERAL (SELECT ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography AS geog) pt "
                f"WHERE {_PUBLIC} "
                "AND ST_DWithin(p.location, pt.geog, :radius) "
                "AND (CAST(:category AS text) IS NULL OR c.slug = :category) "
                "ORDER BY p.location <-> pt.geog, p.id LIMIT :limit"
            ),
            {
                "lat": lat,
                "lng": lng,
                "radius": radius_meters,
                "category": category_slug,
                "limit": limit,
                **_uid(user_id),
            },
        ).mappings()
        return [dict(row) for row in rows]

    def search(self, query, lat, lng, category_slug, limit, user_id=None):
        """Búsqueda por nombre, sin importar mayúsculas ni tildes (`thers_unaccent`,
        índice GIN trigram). Si vienen `lat`/`lng` añade `distance_meters`."""
        with_origin = lat is not None and lng is not None
        distance = (
            ", ST_Distance(p.location, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography)"
            " AS distance_meters"
            if with_origin
            else ""
        )
        tie_break = (
            ", p.location <-> ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography"
            if with_origin
            else ""
        )
        params = {
            "pattern": _like_pattern(query),
            "q": query,
            "category": category_slug,
            "limit": limit,
            **_uid(user_id),
        }
        if with_origin:
            params.update({"lat": lat, "lng": lng})
        rows = db.session.execute(
            text(
                f"SELECT {_columns(user_id)}{distance} {_FROM} "
                f"WHERE {_PUBLIC} "
                f"AND thers_unaccent(lower(p.name)) LIKE thers_unaccent(lower(CAST(:pattern AS text))) "
                f"ESCAPE '{_LIKE_ESCAPE}' "
                "AND (CAST(:category AS text) IS NULL OR c.slug = :category) "
                "ORDER BY similarity(thers_unaccent(lower(p.name)), thers_unaccent(lower(CAST(:q AS text)))) DESC"
                f"{tie_break}, p.name, p.id LIMIT :limit"
            ),
            params,
        ).mappings()
        return [dict(row) for row in rows]

    def get_public_place(self, place_id, user_id=None):
        row = (
            db.session.execute(
                text(
                    f"SELECT {_columns(user_id)}, {_claim_columns(user_id)} "
                    f"{_FROM} WHERE {_PUBLIC} AND p.id = :id"
                ),
                {"id": str(place_id), **_uid(user_id)},
            )
            .mappings()
            .first()
        )
        return dict(row) if row else None

    def record_visit(self, place_id, event, user_id=None):
        """Un solo INSERT ... ON CONFLICT: suma al contador del día local (UTC-6). Si quien visita
        gestiona el lugar, no inserta nada. No se guarda quién visitó (ADR-040 §33)."""
        db.session.execute(
            text(
                "INSERT INTO place_visit_counts (place_id, day, event, count) "
                "SELECT :p, ((now() AT TIME ZONE 'UTC') - interval '6 hours')::date, :e, 1 "
                "WHERE CAST(:u AS uuid) IS NULL OR NOT EXISTS ("
                "  SELECT 1 FROM place_managers m WHERE m.place_id = :p AND m.user_id = CAST(:u AS uuid)) "
                "ON CONFLICT (place_id, day, event) "
                "DO UPDATE SET count = place_visit_counts.count + 1"
            ),
            {"p": str(place_id), "e": event, "u": None if user_id is None else str(user_id)},
        )
        db.session.commit()

    def pulse_counts(self, place_id, window_days):
        """Actividad de los últimos `window_days` días, solo conteos (ADR-040 §32).

        Las reseñas ocultas, los planes cancelados y las publicaciones de cuentas privadas no
        cuentan: el Pulse es público y no debe revelar actividad que el resto no puede ver."""
        row = (
            db.session.execute(
                text(
                    "SELECT "
                    "(SELECT count(*) FROM place_reviews r WHERE r.place_id = :p "
                    "  AND NOT r.is_hidden AND r.created_at > now() - make_interval(days => :d)) "
                    "  AS reviews, "
                    "(SELECT count(*) FROM saved_places s WHERE s.place_id = :p "
                    "  AND s.created_at > now() - make_interval(days => :d)) AS saves, "
                    "(SELECT count(*) FROM place_plans pl WHERE pl.place_id = :p "
                    "  AND pl.status = 'active' "
                    "  AND pl.created_at > now() - make_interval(days => :d)) AS plans, "
                    "(SELECT count(*) FROM posts po JOIN users u ON u.id = po.author_id "
                    "  WHERE po.place_id = :p AND NOT u.is_private "
                    "  AND po.created_at > now() - make_interval(days => :d)) AS posts"
                ),
                {"p": str(place_id), "d": int(window_days)},
            )
            .mappings()
            .first()
        )
        return {key: int(value) for key, value in row.items()}

    # ----------------------------------------------------------------- guardados

    def place_exists(self, place_id):
        return (
            db.session.execute(
                text("SELECT 1 FROM places WHERE id = :id"), {"id": str(place_id)}
            ).first()
            is not None
        )

    def save_place(self, user_id, place_id):
        """Idempotente. True si se guardó ahora, False si ya estaba guardado."""
        row = db.session.execute(
            text(
                "INSERT INTO saved_places (user_id, place_id) VALUES (:u, :p) "
                "ON CONFLICT (user_id, place_id) DO NOTHING RETURNING 1"
            ),
            {"u": str(user_id), "p": str(place_id)},
        ).first()
        db.session.commit()
        return row is not None

    def unsave_place(self, user_id, place_id):
        """Idempotente. True si se quitó ahora, False si no estaba guardado."""
        result = db.session.execute(
            text("DELETE FROM saved_places WHERE user_id = :u AND place_id = :p"),
            {"u": str(user_id), "p": str(place_id)},
        )
        db.session.commit()
        return result.rowcount > 0

    def list_saved(self, user_id, limit, offset):
        # Solo lugares que siguen siendo públicos; un lugar desactivado deja de verse.
        rows = db.session.execute(
            text(
                f"SELECT {_BASE_COLUMNS}, true AS is_saved {_FROM} "
                "JOIN saved_places s ON s.place_id = p.id AND s.user_id = :uid "
                f"WHERE {_PUBLIC} ORDER BY s.created_at DESC, p.id LIMIT :limit OFFSET :offset"
            ),
            {"uid": str(user_id), "limit": limit, "offset": offset},
        ).mappings()
        return [dict(row) for row in rows]

    # ------------------------------------------------------------------ reportes

    def create_report(self, place_id, reporter_id, reason, details):
        """Devuelve `(reporte, creado)`. Si ya hay un reporte ABIERTO de la misma persona,
        sobre el mismo lugar y motivo, devuelve ese y `creado=False` (idempotente)."""
        row = db.session.execute(
            text(
                "INSERT INTO place_reports (place_id, reporter_id, reason, details) "
                "VALUES (:p, :u, :reason, :details) "
                "ON CONFLICT (reporter_id, place_id, reason) "
                "WHERE status IN ('open','reviewing') DO NOTHING "
                "RETURNING id, place_id, reason, details, status, created_at"
            ),
            {"p": str(place_id), "u": str(reporter_id), "reason": reason, "details": details},
        ).mappings().first()
        created = row is not None
        if not created:
            row = db.session.execute(
                text(
                    "SELECT id, place_id, reason, details, status, created_at FROM place_reports "
                    "WHERE reporter_id = :u AND place_id = :p AND reason = :reason "
                    "AND status IN ('open','reviewing')"
                ),
                {"p": str(place_id), "u": str(reporter_id), "reason": reason},
            ).mappings().first()
        db.session.commit()
        return dict(row), created

    def list_place_reports(self, status, limit, offset):
        # Los más antiguos primero: es una cola, se atiende por orden de llegada.
        rows = db.session.execute(
            text(
                "SELECT r.id, r.place_id, r.reason, r.details, r.status, r.created_at, "
                "r.resolved_at, r.resolution_note, p.name AS place_name, p.slug AS place_slug, "
                "p.verification_status AS place_status, p.is_active AS place_is_active "
                "FROM place_reports r JOIN places p ON p.id = r.place_id "
                "WHERE r.status = :status ORDER BY r.created_at, r.id LIMIT :limit OFFSET :offset"
            ),
            {"status": status, "limit": limit, "offset": offset},
        ).mappings()
        return [dict(row) for row in rows]

    def resolve_place_report(self, moderator_id, report_id, status, note):
        """Cierra un reporte pendiente. Devuelve `"not_found"`, `"already_resolved"` o el
        reporte actualizado. La acción queda auditada en la misma transacción."""
        row = db.session.execute(
            text(
                "UPDATE place_reports SET status = :status, resolved_by_user_id = :m, "
                "resolved_at = now(), resolution_note = :note "
                "WHERE id = :id AND status IN ('open','reviewing') "
                "RETURNING id, place_id, reason, details, status, created_at, resolved_at, "
                "resolution_note"
            ),
            {"status": status, "m": str(moderator_id), "note": note, "id": str(report_id)},
        ).mappings().first()
        if row is None:
            exists = db.session.execute(
                text("SELECT 1 FROM place_reports WHERE id = :id"), {"id": str(report_id)}
            ).first()
            db.session.rollback()
            return "already_resolved" if exists else "not_found"
        self._audit(
            moderator_id,
            kinds.AUDIT_PLACE_REPORT_RESOLVED,
            "place_report",
            report_id,
            {"status": status, "place_id": str(row["place_id"])},
        )
        db.session.commit()
        return dict(row)

    # ------------------------------------------------------------------- reseñas

    def upsert_review(self, user_id, place_id, rating, body):
        """`(reseña, creada)`. `xmax = 0` distingue el INSERT del UPDATE en un upsert."""
        row = db.session.execute(
            text(
                "INSERT INTO place_reviews (place_id, user_id, rating, body) "
                "VALUES (:p, :u, :rating, :body) "
                "ON CONFLICT (user_id, place_id) DO UPDATE SET "
                "rating = EXCLUDED.rating, body = EXCLUDED.body, updated_at = now() "
                "RETURNING id, place_id, user_id, rating, body, is_hidden, created_at, "
                "updated_at, (xmax = 0) AS created"
            ),
            {"p": str(place_id), "u": str(user_id), "rating": rating, "body": body},
        ).mappings().one()
        db.session.commit()
        data = dict(row)
        created = data.pop("created")
        return data, created

    def delete_review(self, user_id, place_id):
        row = db.session.execute(
            text("SELECT id FROM place_reviews WHERE user_id = :u AND place_id = :p"),
            {"u": str(user_id), "p": str(place_id)},
        ).first()
        if row is None:
            return None
        return self._delete_review_row(row[0])

    @staticmethod
    def _delete_review_row(review_id):
        """Borra la reseña y devuelve las claves de sus fotos (las filas de las fotos se
        van en cascada; los ARCHIVOS los borra quien llama, ya con el commit hecho)."""
        keys = [
            r[0]
            for r in db.session.execute(
                text("SELECT storage_key FROM media_attachments WHERE review_id = :id"),
                {"id": str(review_id)},
            )
        ]
        db.session.execute(text("DELETE FROM place_reviews WHERE id = :id"), {"id": str(review_id)})
        db.session.commit()
        return keys

    def review_images(self, review_ids, viewer_id=None):
        ids = [str(i) for i in review_ids]
        if not ids:
            return {}
        # Moderación (ADR-044): con ella encendida, un tercero solo ve lo `approved`. Quien subió
        # la foto la ve siempre, con su estado, pero sin URL (ver `present_images`).
        moderated = bool(current_app.config.get("MODERATION_ENABLED"))
        rows = db.session.execute(
            text(
                "SELECT id, review_id, storage_key, width, height, moderation_status "
                "FROM media_attachments "
                "WHERE review_id = ANY(CAST(:ids AS uuid[])) "
                "AND (NOT :moderated OR moderation_status = 'approved' "
                "     OR owner_id = CAST(:viewer AS uuid)) "
                "ORDER BY position, created_at, id"
            ),
            {"ids": ids, "moderated": moderated,
             "viewer": str(viewer_id) if viewer_id else None},
        ).mappings()
        grouped = {}
        for row in rows:
            grouped.setdefault(str(row["review_id"]), []).append(dict(row))
        return grouped

    def add_review_images(self, user_id, place_id, items, limit):
        # Se bloquea la reseña para que dos subidas a la vez no sobrepasen el límite.
        review = db.session.execute(
            text("SELECT id FROM place_reviews WHERE user_id = :u AND place_id = :p FOR UPDATE"),
            {"u": str(user_id), "p": str(place_id)},
        ).first()
        if review is None:
            db.session.rollback()
            return "no_review"
        review_id = review[0]
        current = db.session.execute(
            text("SELECT count(*) FROM media_attachments WHERE review_id = :id"),
            {"id": str(review_id)},
        ).scalar()
        if current + len(items) > limit:
            db.session.rollback()
            return "too_many"
        moderated = bool(current_app.config.get("MODERATION_ENABLED"))
        for offset, item in enumerate(items):
            # El estado se fija SIEMPRE de forma explícita (ADR-044 §2.1).
            attachment_id = db.session.execute(
                text(
                    "INSERT INTO media_attachments "
                    "(owner_id, review_id, storage_key, width, height, position, moderation_status) "
                    "VALUES (:u, :r, :key, :w, :h, :pos, :st) RETURNING id"
                ),
                {
                    "u": str(user_id), "r": str(review_id), "key": item["key"],
                    "w": item["width"], "h": item["height"], "pos": current + offset,
                    "st": initial_status(moderated),
                },
            ).scalar_one()
            if moderated:
                from app.infrastructure.persistence.repositories.content_moderation_repository import (
                    SQLAlchemyContentModerationRepository,
                )

                SQLAlchemyContentModerationRepository().enqueue(
                    moderation_jobs.KIND_IMAGE, moderation_jobs.SUBJECT_MEDIA_ATTACHMENT,
                    attachment_id,
                )
        db.session.commit()
        return self.review_images([review_id], viewer_id=user_id)[str(review_id)]

    def delete_review_image(self, user_id, place_id, image_id):
        row = db.session.execute(
            text(
                "DELETE FROM media_attachments m USING place_reviews r "
                "WHERE m.id = :img AND m.review_id = r.id AND r.user_id = :u AND r.place_id = :p "
                "RETURNING m.storage_key"
            ),
            {"img": str(image_id), "u": str(user_id), "p": str(place_id)},
        ).first()
        db.session.commit()
        return row[0] if row else None

    def list_reviews(self, place_id, viewer_id, limit, offset):
        # Sin bloqueos en ningún sentido entre quien lee y quien escribió (ADR-029). La
        # reseña propia se muestra aunque la moderación la haya ocultado: nadie debe ver
        # desaparecer lo que escribió sin explicación.
        params = {"p": str(place_id), "limit": limit, "offset": offset}
        block_filter = ""
        own_first = ""
        own = "false"
        if viewer_id is not None:
            params["viewer"] = str(viewer_id)
            own = "(r.user_id = :viewer)"
            own_first = "(r.user_id = :viewer) DESC, "
            block_filter = (
                "AND NOT EXISTS (SELECT 1 FROM user_restrictions ur WHERE ur.kind = 'block' "
                "AND ((ur.owner_id = :viewer AND ur.target_id = r.user_id) "
                "OR (ur.owner_id = r.user_id AND ur.target_id = :viewer))) "
            )
        visible = "(NOT r.is_hidden OR r.user_id = :viewer)" if viewer_id is not None else "NOT r.is_hidden"
        rows = db.session.execute(
            text(
                "SELECT r.id, r.place_id, r.rating, r.body, r.is_hidden, r.created_at, "
                f"r.updated_at, {own} AS is_mine, "
                "u.id AS author_id, u.username AS author_username, u.name AS author_name, "
                "u.avatar_path AS author_avatar_path, "
                "rp.body AS reply_body, rp.created_at AS reply_created_at, "
                "rp.updated_at AS reply_updated_at "
                "FROM place_reviews r JOIN users u ON u.id = r.user_id "
                "LEFT JOIN place_review_replies rp ON rp.review_id = r.id "
                f"WHERE r.place_id = :p AND {visible} {block_filter}"
                f"ORDER BY {own_first}r.created_at DESC, r.id LIMIT :limit OFFSET :offset"
            ),
            params,
        ).mappings()
        return [dict(row) for row in rows]

    def delete_review_by_id(self, review_id, owner_id):
        """Borra una reseña por id y autor (retiro por moderación). Devuelve las claves de
        sus fotos, o `None` si ya no existía."""
        row = db.session.execute(
            text("SELECT id FROM place_reviews WHERE id = :id AND user_id = :u"),
            {"id": str(review_id), "u": str(owner_id)},
        ).first()
        if row is None:
            return None
        return self._delete_review_row(row[0])

    def review_summary(self, place_id):
        row = db.session.execute(
            text(
                "SELECT round(avg(rating), 1) AS average, count(*) AS count "
                "FROM place_reviews WHERE place_id = :p AND NOT is_hidden"
            ),
            {"p": str(place_id)},
        ).mappings().one()
        return {"average": row["average"], "count": row["count"]}

    def set_review_hidden(self, actor_id, review_id, hidden, note):
        row = db.session.execute(
            text(
                "UPDATE place_reviews SET is_hidden = :hidden WHERE id = :id "
                "RETURNING id, place_id, is_hidden"
            ),
            {"id": str(review_id), "hidden": hidden},
        ).mappings().first()
        if row is None:
            db.session.rollback()
            return False
        self._audit(
            actor_id,
            kinds.AUDIT_REVIEW_HIDDEN if hidden else kinds.AUDIT_REVIEW_RESTORED,
            "place_review",
            review_id,
            {"place_id": str(row["place_id"]), "note": note},
        )
        db.session.commit()
        return True

    # ---------------------------------------------------------- administración

    def list_places_admin(self, status, query, limit, offset):
        conditions = ["TRUE"]
        params = {"limit": limit, "offset": offset}
        if status is not None:
            conditions.append("p.verification_status = :status")
            params["status"] = status
        if query is not None:
            conditions.append(
                "thers_unaccent(lower(p.name)) LIKE thers_unaccent(lower(CAST(:pattern AS text))) "
                f"ESCAPE '{_LIKE_ESCAPE}'"
            )
            params["pattern"] = _like_pattern(query)
        rows = db.session.execute(
            text(
                f"SELECT {_BASE_COLUMNS}{_ADMIN_EXTRA} {_FROM} WHERE {' AND '.join(conditions)} "
                "ORDER BY p.created_at DESC, p.id LIMIT :limit OFFSET :offset"
            ),
            params,
        ).mappings()
        return [dict(row) for row in rows]

    def get_place_admin(self, place_id):
        row = (
            db.session.execute(
                text(f"SELECT {_BASE_COLUMNS}{_ADMIN_EXTRA} {_FROM} WHERE p.id = :id"),
                {"id": str(place_id)},
            )
            .mappings()
            .first()
        )
        return dict(row) if row else None

    def create_place(self, actor_id, base_slug, category_id, data):
        """Crea un lugar `pending`. Si el slug choca, añade un sufijo aleatorio."""
        params = {
            "name": data["name"],
            "category_id": str(category_id),
            "lat": data["latitude"],
            "lng": data["longitude"],
            "description": data.get("description"),
            "address": data.get("address"),
            "municipality": data.get("municipality"),
            "department": data.get("department"),
            "phone": data.get("phone"),
            "website": data.get("website"),
            "source": data["source"],
            "coordinate_source": data["coordinate_source"],
            "actor": str(actor_id),
        }
        insert = text(
            "INSERT INTO places (name, slug, description, category_id, location, address, "
            "municipality, department, phone, website, source, coordinate_source, "
            "created_by_user_id) "
            "VALUES (:name, :slug, :description, :category_id, "
            "ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, :address, :municipality, "
            ":department, :phone, :website, :source, :coordinate_source, :actor) RETURNING id"
        )
        slug = base_slug
        for attempt in range(4):
            try:
                with db.session.begin_nested():
                    place_id = db.session.execute(insert, {**params, "slug": slug}).scalar()
                break
            except IntegrityError:
                slug = f"{base_slug}-{secrets.token_hex(3)}"
        else:
            db.session.rollback()
            raise RuntimeError("No se pudo generar un slug único")
        self._audit(
            actor_id,
            kinds.AUDIT_PLACE_CREATED,
            "place",
            place_id,
            {"name": data["name"], "category_id": str(category_id)},
        )
        db.session.commit()
        return place_id

    def update_place(self, actor_id, place_id, changes, category_id=None):
        """Aplica solo los campos que cambian de verdad y audita antes/después. Devuelve
        `False` si el lugar no existe."""
        before = self.get_place_admin(place_id)
        if before is None:
            return False

        sets, params, audit = [], {"id": str(place_id)}, {}
        for key, column in _EDITABLE_COLUMNS.items():
            if key in changes and changes[key] != before[column]:
                sets.append(f"{column} = :{key}")
                params[key] = changes[key]
                audit[key] = [before[column], changes[key]]
        if category_id is not None and str(category_id) != str(before["category_id"]):
            sets.append("category_id = :category_id")
            params["category_id"] = str(category_id)
            audit["category"] = [before["category_slug"], changes["category"]]
        if "latitude" in changes and (
            changes["latitude"] != before["latitude"] or changes["longitude"] != before["longitude"]
        ):
            sets.append("location = ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography")
            params.update({"lat": changes["latitude"], "lng": changes["longitude"]})
            audit["location"] = [
                [before["latitude"], before["longitude"]],
                [changes["latitude"], changes["longitude"]],
            ]

        if sets:
            db.session.execute(
                text(f"UPDATE places SET {', '.join(sets)}, updated_at = now() WHERE id = :id"),
                params,
            )
            self._audit(actor_id, kinds.AUDIT_PLACE_UPDATED, "place", place_id, audit)
        db.session.commit()
        return True

    def set_image(self, actor_id, place_id, key):
        """Fija (o quita, con `None`) la imagen del lugar y audita el cambio en la misma transacción.
        Devuelve `(existe, clave_anterior)`: la anterior se borra del almacenamiento fuera de aquí."""
        row = db.session.execute(
            text("SELECT image_key FROM places WHERE id = :id FOR UPDATE"), {"id": str(place_id)}
        ).first()
        if row is None:
            db.session.rollback()
            return False, None
        previous = row[0]
        db.session.execute(
            text("UPDATE places SET image_key = :k, updated_at = now() WHERE id = :id"),
            {"k": key, "id": str(place_id)},
        )
        self._audit(actor_id, kinds.AUDIT_PLACE_UPDATED, "place", place_id, {"image": [bool(previous), bool(key)]})
        db.session.commit()
        return True, previous

    def set_place_status(self, actor_id, place_id, changes):
        """Cambia `verification_status` y/o `is_active`. Al verificar, registra quién y
        cuándo. Devuelve `False` si el lugar no existe."""
        before = self.get_place_admin(place_id)
        if before is None:
            return False

        sets, params, audit = [], {"id": str(place_id)}, {}
        new_status = changes.get("verification_status")
        if new_status is not None and new_status != before["verification_status"]:
            sets.append("verification_status = :status")
            params["status"] = new_status
            audit["verification_status"] = [before["verification_status"], new_status]
            if new_status == kinds.STATUS_VERIFIED:
                sets.append("verified_by_user_id = :actor")
                sets.append("last_verified_at = now()")
                params["actor"] = str(actor_id)
        if "is_active" in changes and changes["is_active"] != before["is_active"]:
            sets.append("is_active = :active")
            params["active"] = changes["is_active"]
            audit["is_active"] = [before["is_active"], changes["is_active"]]

        if sets:
            db.session.execute(
                text(f"UPDATE places SET {', '.join(sets)}, updated_at = now() WHERE id = :id"),
                params,
            )
            self._audit(actor_id, kinds.AUDIT_PLACE_STATUS_CHANGED, "place", place_id, audit)
        db.session.commit()
        return True

    def summary(self):
        by_status = {
            status: count
            for status, count in db.session.execute(
                text("SELECT verification_status, count(*) FROM places GROUP BY 1")
            )
        }
        open_reports = db.session.execute(
            text("SELECT count(*) FROM place_reports WHERE status IN ('open','reviewing')")
        ).scalar()
        inactive = db.session.execute(
            text("SELECT count(*) FROM places WHERE NOT is_active")
        ).scalar()
        return {
            "places_by_status": {s: by_status.get(s, 0) for s in kinds.VERIFICATION_STATUSES},
            "places_inactive": inactive,
            "open_reports": open_reports,
        }

    # ------------------------------------------------------------------ auditoría

    @staticmethod
    def _audit(actor_id, action, resource_type, resource_id, changes):
        """Se escribe en la MISMA transacción que el cambio: o quedan los dos o ninguno."""
        db.session.execute(
            text(
                "INSERT INTO admin_audit_log (actor_id, action, resource_type, resource_id, changes) "
                "VALUES (:actor, :action, :rtype, :rid, CAST(:changes AS jsonb))"
            ),
            {
                "actor": str(actor_id),
                "action": action,
                "rtype": resource_type,
                "rid": str(resource_id),
                "changes": json.dumps(changes, ensure_ascii=False, default=str),
            },
        )
