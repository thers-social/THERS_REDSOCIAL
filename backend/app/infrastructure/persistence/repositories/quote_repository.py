# Repositorio del cotizador (ADR-040 fase 10). Parámetros siempre ligados. El catálogo se lee
# DENTRO de la misma transacción que crea la cotización, así el precio que se copia es el vigente.

from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.domain.quotes import quotes
from app.domain.quotes.quotes import QuoteItemLimitError, QuoteItemNameTakenError
from app.extensions import db
from app.infrastructure.persistence.repositories.place_cards import fetch_place_cards
from app.infrastructure.persistence.repositories.place_notifications import PlaceNotifierMixin

_ITEM = "id, place_id, name, description, unit, unit_price_cents, is_active"
_QUOTE = (
    "q.id, q.place_id, q.user_id, q.reservation_id, q.currency, q.total_cents, q.note, "
    "q.valid_until, q.created_at, q.status, q.decided_at"
)


class SQLAlchemyQuoteRepository(PlaceNotifierMixin):
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

    # ------------------------------------------------------------------ catálogo

    def list_items(self, place_id, only_active):
        rows = db.session.execute(
            text(
                f"SELECT {_ITEM} FROM place_quote_items WHERE place_id = :p "
                f"{'AND is_active ' if only_active else ''}ORDER BY lower(name), id"
            ),
            {"p": str(place_id)},
        ).mappings()
        return [dict(row) for row in rows]

    def get_item(self, place_id, item_id):
        row = db.session.execute(
            text(f"SELECT {_ITEM} FROM place_quote_items WHERE id = :i AND place_id = :p"),
            {"i": str(item_id), "p": str(place_id)},
        ).mappings().first()
        return dict(row) if row else None

    def create_item(self, place_id, fields):
        # La fila del lugar se bloquea para que el tope de artículos no se rebase en paralelo.
        db.session.execute(text("SELECT 1 FROM places WHERE id = :p FOR UPDATE"), {"p": str(place_id)})
        active = db.session.execute(
            text("SELECT count(*) FROM place_quote_items WHERE place_id = :p AND is_active"),
            {"p": str(place_id)},
        ).scalar()
        if active >= quotes.MAX_ACTIVE_ITEMS_PER_PLACE:
            db.session.rollback()
            raise QuoteItemLimitError()
        try:
            row = db.session.execute(
                text(
                    "INSERT INTO place_quote_items (place_id, name, description, unit, unit_price_cents) "
                    "VALUES (:p, :name, :description, :unit, :price) RETURNING id"
                ),
                {"p": str(place_id), "name": fields["name"], "description": fields["description"],
                 "unit": fields["unit"], "price": fields["unit_price_cents"]},
            ).first()
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            raise QuoteItemNameTakenError()
        return row[0]

    def update_item(self, place_id, item_id, fields):
        columns = {"name": "name", "description": "description", "unit": "unit",
                   "unit_price_cents": "unit_price_cents", "is_active": "is_active"}
        sets = [f"{columns[key]} = :{key}" for key in fields if key in columns]
        params = {key: value for key, value in fields.items() if key in columns}
        params.update({"i": str(item_id), "p": str(place_id)})
        try:
            row = db.session.execute(
                text(f"UPDATE place_quote_items SET {', '.join(sets)}, updated_at = now() "
                     "WHERE id = :i AND place_id = :p RETURNING id"),
                params,
            ).first()
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            raise QuoteItemNameTakenError()
        return row is not None

    def delete_item(self, place_id, item_id):
        row = db.session.execute(
            text("DELETE FROM place_quote_items WHERE id = :i AND place_id = :p RETURNING id"),
            {"i": str(item_id), "p": str(place_id)},
        ).first()
        db.session.commit()
        return row is not None

    def count_active_items(self, place_id):
        return db.session.execute(
            text("SELECT count(*) FROM place_quote_items WHERE place_id = :p AND is_active"),
            {"p": str(place_id)},
        ).scalar()

    # ------------------------------------------------------------------ cotizaciones

    def reservation_belongs_to(self, reservation_id, user_id, place_id):
        return (
            db.session.execute(
                text("SELECT 1 FROM place_reservations WHERE id = :r AND user_id = :u AND place_id = :p"),
                {"r": str(reservation_id), "u": str(user_id), "p": str(place_id)},
            ).first()
            is not None
        )

    def create_quote(self, place_id, user_id, reservation_id, lines, note):
        """Precios leídos y copiados en la MISMA transacción. Devuelve `(id, total)` o lanza
        `QuoteItemNotFoundError` si algún artículo no existe o está inactivo."""
        ids = [item_id for item_id, _ in lines]
        rows = db.session.execute(
            text(
                f"SELECT {_ITEM} FROM place_quote_items WHERE place_id = :p AND is_active "
                "AND id = ANY(CAST(:ids AS uuid[])) FOR SHARE"
            ),
            {"p": str(place_id), "ids": ids},
        ).mappings().all()
        items = {str(row["id"]): {**row, "id": str(row["id"])} for row in rows}
        if len(items) != len(ids):
            db.session.rollback()
            raise quotes.QuoteItemNotFoundError()
        computed, total = quotes.compute(items, lines)
        valid_until = datetime.now(timezone.utc) + quotes.VALID_FOR
        quote_id = db.session.execute(
            text(
                "INSERT INTO place_quotes (place_id, user_id, reservation_id, currency, total_cents, note, valid_until) "
                "VALUES (:p, :u, :r, :cur, :total, :note, :valid) RETURNING id"
            ),
            {"p": str(place_id), "u": str(user_id), "r": str(reservation_id) if reservation_id else None,
             "cur": quotes.CURRENCY, "total": total, "note": note, "valid": valid_until},
        ).scalar()
        for position, line in enumerate(computed):
            db.session.execute(
                text(
                    "INSERT INTO place_quote_lines (quote_id, item_id, name, unit, unit_price_cents, "
                    "quantity, line_total_cents, position) "
                    "VALUES (:q, :i, :name, :unit, :price, :qty, :total, :pos)"
                ),
                {"q": str(quote_id), "i": line["item_id"], "name": line["name"], "unit": line["unit"],
                 "price": line["unit_price_cents"], "qty": line["quantity"], "total": line["line_total_cents"],
                 "pos": position},
            )
        db.session.commit()
        return quote_id

    def get_quote(self, quote_id):
        row = db.session.execute(
            text(f"SELECT {_QUOTE} FROM place_quotes q WHERE q.id = :id"), {"id": str(quote_id)}
        ).mappings().first()
        return dict(row) if row else None

    def decide(self, quote_id, place_id, decision, user_id):
        """Pasa de `pending` a `accepted`/`rejected` en UNA sentencia: dos gestores a la vez no
        pueden decidir dos veces. Devuelve `'ok'`, `'expired'` o `'decided'`; `None` si no existe."""
        row = db.session.execute(
            text(
                "SELECT status, valid_until FROM place_quotes "
                "WHERE id = :q AND place_id = :p FOR UPDATE"
            ),
            {"q": str(quote_id), "p": str(place_id)},
        ).mappings().first()
        if row is None:
            db.session.rollback()
            return None
        if row["status"] != "pending":
            db.session.rollback()
            return "decided"
        if row["valid_until"] <= datetime.now(timezone.utc):
            db.session.rollback()
            return "expired"
        db.session.execute(
            text(
                "UPDATE place_quotes SET status = :s, decided_at = now(), decided_by = :u "
                "WHERE id = :q"
            ),
            {"s": decision, "u": str(user_id), "q": str(quote_id)},
        )
        db.session.commit()
        return "ok"

    def place_name(self, place_id):
        return db.session.execute(
            text("SELECT name FROM places WHERE id = :p"), {"p": str(place_id)}
        ).scalar()

    def requester_name(self, user_id):
        row = db.session.execute(
            text("SELECT name, username FROM users WHERE id = :u"), {"u": str(user_id)}
        ).mappings().first()
        return (row["name"] or row["username"]) if row else None

    def list_for_user(self, user_id, limit):
        rows = db.session.execute(
            text(f"SELECT {_QUOTE} FROM place_quotes q WHERE q.user_id = :u "
                 "ORDER BY q.created_at DESC, q.id LIMIT :limit"),
            {"u": str(user_id), "limit": limit},
        ).mappings()
        return [dict(row) for row in rows]

    def list_for_place(self, place_id, limit, offset):
        rows = db.session.execute(
            text(
                f"SELECT {_QUOTE}, u.username AS user_username, u.name AS user_name "
                "FROM place_quotes q JOIN users u ON u.id = q.user_id WHERE q.place_id = :p "
                "ORDER BY q.created_at DESC, q.id LIMIT :limit OFFSET :offset"
            ),
            {"p": str(place_id), "limit": limit + 1, "offset": offset},
        ).mappings()
        return [dict(row) for row in rows]

    def lines_of(self, quote_ids):
        if not quote_ids:
            return {}
        rows = db.session.execute(
            text(
                "SELECT quote_id, name, unit, unit_price_cents, quantity, line_total_cents "
                "FROM place_quote_lines WHERE quote_id = ANY(CAST(:ids AS uuid[])) ORDER BY position, id"
            ),
            {"ids": [str(i) for i in quote_ids]},
        ).mappings()
        grouped = {}
        for row in rows:
            grouped.setdefault(str(row["quote_id"]), []).append(dict(row))
        return grouped
