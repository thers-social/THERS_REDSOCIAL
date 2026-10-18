# Repositorio de reservas (ADR-040 fase 8). La garantía contra la sobreventa es la fila de
# `place_reservation_settings` bloqueada con `SELECT ... FOR UPDATE` mientras se cuenta el cupo y
# se inserta: dos solicitudes simultáneas para el mismo lugar se serializan, así que la suma de
# personas por horario nunca supera la capacidad. Parámetros siempre ligados.

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.domain.reservations import kinds
from app.domain.reservations.exceptions import (
    InvalidReservationDataError,
    ReservationConflictError,
    ReservationsClosedError,
    SlotFullError,
)
from app.extensions import db
from app.infrastructure.persistence.repositories.place_cards import fetch_place_cards
from app.infrastructure.persistence.repositories.place_notifications import PlaceNotifierMixin

_COLUMNS = (
    "r.id, r.place_id, r.user_id, r.starts_at, r.party_size, r.note, r.status, "
    "r.decision_note, r.created_at, r.updated_at"
)


class SQLAlchemyReservationRepository(PlaceNotifierMixin):
    def public_place_exists(self, place_id):
        return (
            db.session.execute(
                text(
                    "SELECT 1 FROM places p JOIN place_categories c ON c.id = p.category_id "
                    "WHERE p.id = :id AND p.is_active AND p.verification_status IN ('verified', 'unverified') "
                    "AND c.is_active"
                ),
                {"id": str(place_id)},
            ).first()
            is not None
        )

    def place_cards(self, place_ids):
        return fetch_place_cards(place_ids)

    def is_manager(self, place_id, user_id):
        return (
            db.session.execute(
                text("SELECT 1 FROM place_managers WHERE place_id = :p AND user_id = :u"),
                {"p": str(place_id), "u": str(user_id)},
            ).first()
            is not None
        )

    def get_settings(self, place_id):
        row = db.session.execute(
            text(
                "SELECT enabled, capacity, max_party_size FROM place_reservation_settings "
                "WHERE place_id = :p"
            ),
            {"p": str(place_id)},
        ).mappings().first()
        if row is None:
            # Sin fila, las reservas están ACTIVAS con los valores por defecto (ADR-043 §2.7): quien
            # gestiona el lugar las apaga guardando `enabled = false`.
            return {"enabled": True, "capacity": kinds.DEFAULT_CAPACITY,
                    "max_party_size": kinds.DEFAULT_MAX_PARTY}
        return dict(row)

    def upsert_settings(self, place_id, enabled, capacity, max_party_size):
        db.session.execute(
            text(
                "INSERT INTO place_reservation_settings (place_id, enabled, capacity, max_party_size) "
                "VALUES (:p, :e, :c, :m) ON CONFLICT (place_id) DO UPDATE SET "
                "enabled = EXCLUDED.enabled, capacity = EXCLUDED.capacity, "
                "max_party_size = EXCLUDED.max_party_size, updated_at = now()"
            ),
            {"p": str(place_id), "e": enabled, "c": capacity, "m": max_party_size},
        )
        db.session.commit()

    def create(self, user_id, place_id, starts_at, party_size, note):
        # La fila se crea con los valores por defecto la primera vez, para poder bloquearla
        # (`FOR UPDATE`) y serializar las reservas simultáneas. Si ya existe, no se toca.
        db.session.execute(
            text(
                "INSERT INTO place_reservation_settings (place_id, enabled, capacity, max_party_size) "
                "VALUES (:p, true, :c, :m) ON CONFLICT (place_id) DO NOTHING"
            ),
            {"p": str(place_id), "c": kinds.DEFAULT_CAPACITY, "m": kinds.DEFAULT_MAX_PARTY},
        )
        settings = db.session.execute(
            text(
                "SELECT enabled, capacity, max_party_size FROM place_reservation_settings "
                "WHERE place_id = :p FOR UPDATE"
            ),
            {"p": str(place_id)},
        ).mappings().first()
        try:
            if settings is None or not settings["enabled"]:
                raise ReservationsClosedError()
            if party_size > settings["max_party_size"]:
                raise InvalidReservationDataError(
                    f"party_size no puede superar {settings['max_party_size']} personas"
                )
            active = db.session.execute(
                text(
                    "SELECT count(*) FROM place_reservations WHERE user_id = :u "
                    "AND status IN ('pending','confirmed') AND starts_at > now()"
                ),
                {"u": str(user_id)},
            ).scalar()
            if active >= kinds.MAX_ACTIVE_PER_USER:
                raise ReservationConflictError()
            taken = db.session.execute(
                text(
                    "SELECT COALESCE(sum(party_size), 0) FROM place_reservations "
                    "WHERE place_id = :p AND starts_at = :s AND status IN ('pending','confirmed')"
                ),
                {"p": str(place_id), "s": starts_at},
            ).scalar()
            if taken + party_size > settings["capacity"]:
                raise SlotFullError()
            row = db.session.execute(
                text(
                    "INSERT INTO place_reservations (place_id, user_id, starts_at, party_size, note) "
                    "VALUES (:p, :u, :s, :n, :note) RETURNING id"
                ),
                {"p": str(place_id), "u": str(user_id), "s": starts_at, "n": party_size, "note": note},
            ).first()
            db.session.commit()
            return row[0]
        except IntegrityError:
            db.session.rollback()
            raise ReservationConflictError()
        except Exception:
            db.session.rollback()
            raise

    def get(self, reservation_id):
        row = db.session.execute(
            text(f"SELECT {_COLUMNS} FROM place_reservations r WHERE r.id = :id"),
            {"id": str(reservation_id)},
        ).mappings().first()
        return dict(row) if row else None

    def requester_name(self, user_id):
        row = db.session.execute(
            text("SELECT name, username FROM users WHERE id = :u"), {"u": str(user_id)}
        ).mappings().first()
        return (row["name"] or row["username"]) if row else None

    def list_for_user(self, user_id, limit):
        rows = db.session.execute(
            text(
                f"SELECT {_COLUMNS} FROM place_reservations r WHERE r.user_id = :u "
                "ORDER BY r.starts_at DESC, r.id LIMIT :limit"
            ),
            {"u": str(user_id), "limit": limit},
        ).mappings()
        return [dict(row) for row in rows]

    def list_for_place(self, place_id, status, limit, offset):
        rows = db.session.execute(
            text(
                f"SELECT {_COLUMNS}, u.username AS user_username, u.name AS user_name, "
                "u.avatar_path AS user_avatar_path "
                "FROM place_reservations r JOIN users u ON u.id = r.user_id "
                "WHERE r.place_id = :p AND (CAST(:status AS text) IS NULL OR r.status = :status) "
                "ORDER BY r.starts_at, r.id LIMIT :limit OFFSET :offset"
            ),
            {"p": str(place_id), "status": status, "limit": limit + 1, "offset": offset},
        ).mappings()
        return [dict(row) for row in rows]

    # ------------------------------------------------------------------ horario (fase 9)

    def get_week(self, place_id):
        rows = db.session.execute(
            text(
                "SELECT weekday, opens, closes FROM place_opening_hours "
                "WHERE place_id = :p ORDER BY weekday, opens"
            ),
            {"p": str(place_id)},
        ).all()
        week = {}
        for weekday, opens, closes in rows:
            week.setdefault(weekday, []).append((opens, closes))
        return week

    def replace_week(self, place_id, week):
        db.session.execute(
            text("DELETE FROM place_opening_hours WHERE place_id = :p"), {"p": str(place_id)}
        )
        for weekday, intervals in week.items():
            for opens, closes in intervals:
                db.session.execute(
                    text(
                        "INSERT INTO place_opening_hours (place_id, weekday, opens, closes) "
                        "VALUES (:p, :d, :o, :c)"
                    ),
                    {"p": str(place_id), "d": weekday, "o": opens, "c": closes},
                )
        db.session.commit()

    def get_closures(self, place_id, start, end):
        rows = db.session.execute(
            text(
                "SELECT closed_on, reason FROM place_closures "
                "WHERE place_id = :p AND closed_on BETWEEN :a AND :b ORDER BY closed_on"
            ),
            {"p": str(place_id), "a": start, "b": end},
        ).all()
        return {closed_on: reason for closed_on, reason in rows}

    def add_closure(self, place_id, day, reason):
        db.session.execute(
            text(
                "INSERT INTO place_closures (place_id, closed_on, reason) VALUES (:p, :d, :r) "
                "ON CONFLICT (place_id, closed_on) DO UPDATE SET reason = EXCLUDED.reason"
            ),
            {"p": str(place_id), "d": day, "r": reason},
        )
        db.session.commit()

    def delete_closure(self, place_id, day):
        row = db.session.execute(
            text("DELETE FROM place_closures WHERE place_id = :p AND closed_on = :d RETURNING 1"),
            {"p": str(place_id), "d": day},
        ).first()
        db.session.commit()
        return row is not None

    def people_by_slot(self, place_id, start, end):
        """`{starts_at: personas}` de reservas activas entre `start` y `end` (UTC)."""
        rows = db.session.execute(
            text(
                "SELECT starts_at, sum(party_size) FROM place_reservations "
                "WHERE place_id = :p AND starts_at >= :a AND starts_at < :b "
                "AND status IN ('pending','confirmed') GROUP BY starts_at"
            ),
            {"p": str(place_id), "a": start, "b": end},
        ).all()
        return {starts_at: int(total) for starts_at, total in rows}

    def reservations_by_day(self, place_id, start, end):
        """`{fecha local: {pending, confirmed, people}}` entre `start` y `end` (UTC)."""
        rows = db.session.execute(
            text(
                "SELECT ((starts_at AT TIME ZONE 'UTC') - interval '6 hours')::date AS day, status, "
                "count(*), sum(party_size) FROM place_reservations "
                "WHERE place_id = :p AND starts_at >= :a AND starts_at < :b "
                "AND status IN ('pending','confirmed') GROUP BY 1, 2"
            ),
            {"p": str(place_id), "a": start, "b": end},
        ).all()
        days = {}
        for day, status, count, people in rows:
            entry = days.setdefault(day, {"pending": 0, "confirmed": 0, "people": 0})
            entry[status] = int(count)
            entry["people"] += int(people)
        return days

    def cancel(self, reservation_id, user_id):
        """Cancela una reserva activa y futura de la persona. True si cambió."""
        row = db.session.execute(
            text(
                "UPDATE place_reservations SET status = 'cancelled', updated_at = now() "
                "WHERE id = :id AND user_id = :u AND status IN ('pending','confirmed') "
                "AND starts_at > now() RETURNING id"
            ),
            {"id": str(reservation_id), "u": str(user_id)},
        ).first()
        db.session.commit()
        return row is not None

    def decide(self, reservation_id, place_id, decider_id, confirm, note):
        """Confirma o rechaza una reserva PENDIENTE y futura de ese lugar. True si cambió."""
        row = db.session.execute(
            text(
                "UPDATE place_reservations SET status = :status, decided_by = :d, "
                "decision_note = :note, updated_at = now() "
                "WHERE id = :id AND place_id = :p AND status = 'pending' AND starts_at > now() "
                "RETURNING id"
            ),
            {
                "status": kinds.CONFIRMED if confirm else kinds.DECLINED, "d": str(decider_id),
                "note": note, "id": str(reservation_id), "p": str(place_id),
            },
        ).first()
        db.session.commit()
        return row is not None
