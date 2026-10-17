# Adaptador SQLAlchemy de las acciones pendientes de Tero (ADR-041 §6.2). Único punto que
# traduce entre `tero_pending_actions` (PostgreSQL) y los casos de uso.
#
# La garantía de «una sola vez» vive AQUÍ, en SQL: `claim()` es un único UPDATE condicionado al
# estado. Dos confirmaciones simultáneas de la misma acción compiten por esa fila y solo una la
# gana; la otra ve 0 filas y no ejecuta nada.

import json

from sqlalchemy import text

from app.extensions import db


def _row(row):
    return {
        "id": str(row["id"]),
        "user_id": str(row["user_id"]),
        "kind": row["kind"],
        "params": row["params"],
        "summary": row["summary"],
        "status": row["status"],
        "expires_at": row["expires_at"],
    }


_COLUMNS = "id, user_id, kind, params, summary, status, expires_at"


class SQLAlchemyTeroActionRepository:
    def pending_count(self, user_id, now):
        return db.session.execute(
            text(
                "SELECT count(*) FROM tero_pending_actions "
                "WHERE user_id = :u AND status = 'pending' AND expires_at > :now"
            ),
            {"u": str(user_id), "now": now},
        ).scalar_one()

    def create(self, user_id, kind, params, summary, expires_at):
        row = (
            db.session.execute(
                text(
                    "INSERT INTO tero_pending_actions (user_id, kind, params, summary, expires_at) "
                    "VALUES (:u, :k, CAST(:p AS jsonb), :s, :e) "
                    f"RETURNING {_COLUMNS}"
                ),
                {
                    "u": str(user_id), "k": kind, "p": json.dumps(params),
                    "s": summary, "e": expires_at,
                },
            )
            .mappings()
            .one()
        )
        db.session.commit()
        return _row(row)

    def get_owned(self, action_id, user_id):
        """`None` si no existe O no es de `user_id`: no se distingue."""
        row = (
            db.session.execute(
                text(
                    f"SELECT {_COLUMNS} FROM tero_pending_actions "
                    "WHERE id = :id AND user_id = :u"
                ),
                {"id": str(action_id), "u": str(user_id)},
            )
            .mappings()
            .first()
        )
        return _row(row) if row else None

    def claim(self, action_id, user_id, now):
        """Pasa de `pending` a `confirmed` de forma atómica. Devuelve la acción solo a quien la
        gana; `None` si ya no está pendiente, venció o no es suya."""
        row = (
            db.session.execute(
                text(
                    "UPDATE tero_pending_actions SET status = 'confirmed', resolved_at = :now "
                    "WHERE id = :id AND user_id = :u AND status = 'pending' AND expires_at > :now "
                    f"RETURNING {_COLUMNS}"
                ),
                {"id": str(action_id), "u": str(user_id), "now": now},
            )
            .mappings()
            .first()
        )
        db.session.commit()
        return _row(row) if row else None

    def cancel(self, action_id, user_id, now):
        """True si pasó de `pending` a `cancelled` ahora."""
        row = db.session.execute(
            text(
                "UPDATE tero_pending_actions SET status = 'cancelled', resolved_at = :now "
                "WHERE id = :id AND user_id = :u AND status = 'pending' RETURNING 1"
            ),
            {"id": str(action_id), "u": str(user_id), "now": now},
        ).first()
        db.session.commit()
        return row is not None

    def mark_failed(self, action_id, now):
        db.session.execute(
            text(
                "UPDATE tero_pending_actions SET status = 'failed', resolved_at = :now "
                "WHERE id = :id AND status = 'confirmed'"
            ),
            {"id": str(action_id), "now": now},
        )
        db.session.commit()
