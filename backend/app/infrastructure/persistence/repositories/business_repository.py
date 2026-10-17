# Repositorio del panel de negocio (ADR-040 fase 7). Solo lo que es propio de quien gestiona un
# lugar: sus lugares, sus cifras y las respuestas a reseñas. Editar el lugar reutiliza
# `SQLAlchemyPlaceRepository.update_place` (con su auditoría). Parámetros siempre ligados.

from sqlalchemy import text

from app.extensions import db
from app.infrastructure.persistence.repositories.place_notifications import PlaceNotifierMixin


class SQLAlchemyBusinessRepository(PlaceNotifierMixin):
    def is_manager(self, place_id, user_id):
        return (
            db.session.execute(
                text("SELECT 1 FROM place_managers WHERE place_id = :p AND user_id = :u"),
                {"p": str(place_id), "u": str(user_id)},
            ).first()
            is not None
        )

    def list_managed(self, user_id):
        rows = db.session.execute(
            text(
                "SELECT p.id, p.name, p.municipality, p.department, c.slug AS category_slug, "
                "c.name AS category_name, p.is_active, p.verification_status, "
                "(SELECT round(avg(rv.rating), 1) FROM place_reviews rv "
                " WHERE rv.place_id = p.id AND NOT rv.is_hidden) AS rating_average, "
                "(SELECT count(*) FROM place_reviews rv "
                " WHERE rv.place_id = p.id AND NOT rv.is_hidden) AS reviews_count "
                "FROM place_managers m JOIN places p ON p.id = m.place_id "
                "JOIN place_categories c ON c.id = p.category_id "
                "WHERE m.user_id = :u ORDER BY lower(p.name), p.id"
            ),
            {"u": str(user_id)},
        ).mappings()
        return [dict(row) for row in rows]

    def stats(self, place_id):
        row = db.session.execute(
            text(
                "SELECT "
                "(SELECT count(*) FROM saved_places s WHERE s.place_id = :p) AS saves, "
                "(SELECT count(*) FROM place_reviews r WHERE r.place_id = :p AND NOT r.is_hidden) "
                "  AS reviews, "
                "(SELECT round(avg(r.rating), 1) FROM place_reviews r "
                "  WHERE r.place_id = :p AND NOT r.is_hidden) AS rating_average, "
                "(SELECT count(*) FROM place_reviews r WHERE r.place_id = :p AND NOT r.is_hidden "
                "  AND NOT EXISTS (SELECT 1 FROM place_review_replies x WHERE x.review_id = r.id)) "
                "  AS reviews_without_reply, "
                "(SELECT count(*) FROM place_plans pl WHERE pl.place_id = :p "
                "  AND pl.status = 'active' AND pl.starts_at > now()) AS upcoming_plans"
            ),
            {"p": str(place_id)},
        ).mappings().first()
        return dict(row)

    def analytics_rows(self, place_id, start, end):
        """Filas agrupadas por día LOCAL (UTC-6) entre las fechas `start` y `end` (incluidas).

        Solo conteos: ninguna fila lleva un identificador de persona. Los guardados y los planes
        se devuelven completos; el dominio decide si se muestran (mínimo de 5)."""
        day = "((created_at AT TIME ZONE 'UTC') - interval '6 hours')::date"
        params = {"p": str(place_id), "start": start, "end": end}

        def rows(sql):
            return [dict(row) for row in db.session.execute(text(sql), params).mappings()]

        where = f"WHERE place_id = :p AND {day} BETWEEN :start AND :end"
        return {
            "reviews": rows(
                f"SELECT {day} AS day, count(*) AS count, coalesce(sum(rating), 0) AS rating_sum "
                f"FROM place_reviews {where} AND NOT is_hidden GROUP BY 1"
            ),
            "saves": rows(f"SELECT {day} AS day, count(*) AS count FROM saved_places {where} GROUP BY 1"),
            "plans": rows(
                f"SELECT {day} AS day, count(*) AS count FROM place_plans {where} GROUP BY 1"
            ),
            "posts": rows(f"SELECT {day} AS day, count(*) AS count FROM posts {where} GROUP BY 1"),
            "reservations": rows(
                f"SELECT {day} AS day, status, count(*) AS count, coalesce(sum(party_size), 0) AS people "
                f"FROM place_reservations {where} GROUP BY 1, 2"
            ),
            "quotes": rows(
                f"SELECT {day} AS day, status, count(*) AS count, coalesce(sum(total_cents), 0) AS total_cents "
                f"FROM place_quotes {where} GROUP BY 1, 2"
            ),
            # Contadores anónimos (ADR-040 §33): ya vienen por día local, sin persona.
            "visits": rows(
                "SELECT day, event, count FROM place_visit_counts "
                "WHERE place_id = :p AND day BETWEEN :start AND :end"
            ),
        }

    def visible_review_exists(self, place_id, review_id):
        return (
            db.session.execute(
                text(
                    "SELECT 1 FROM place_reviews WHERE id = :r AND place_id = :p AND NOT is_hidden"
                ),
                {"r": str(review_id), "p": str(place_id)},
            ).first()
            is not None
        )

    def upsert_reply(self, review_id, place_id, author_id, body):
        row = db.session.execute(
            text(
                "INSERT INTO place_review_replies (review_id, place_id, author_id, body) "
                "VALUES (:r, :p, :a, :body) "
                "ON CONFLICT (review_id) DO UPDATE SET body = EXCLUDED.body, "
                "author_id = EXCLUDED.author_id, updated_at = now() "
                "RETURNING id, review_id, body, created_at, updated_at"
            ),
            {"r": str(review_id), "p": str(place_id), "a": str(author_id), "body": body},
        ).mappings().first()
        db.session.commit()
        return dict(row)

    def delete_reply(self, review_id, place_id):
        row = db.session.execute(
            text(
                "DELETE FROM place_review_replies WHERE review_id = :r AND place_id = :p RETURNING id"
            ),
            {"r": str(review_id), "p": str(place_id)},
        ).first()
        db.session.commit()
        return row is not None
