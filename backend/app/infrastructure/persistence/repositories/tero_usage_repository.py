# Adaptador SQLAlchemy del contador de gasto de Tero (ADR-041 §8.2). Único punto que traduce
# entre `tero_usage` (PostgreSQL) y el caso de uso.
#
# PostgreSQL y no memoria del proceso: con varios workers un contador en memoria permitiría gastar
# varias veces el tope. Aun así el corte es aproximado: varias peticiones EN VUELO al cruzar el
# tope pueden pasarse por el costo de unos pocos mensajes (centavos), no más.

from sqlalchemy import text

from app.extensions import db


class SQLAlchemyTeroUsageRepository:
    def spent_micro(self, period):
        row = db.session.execute(
            text("SELECT cost_micro_usd FROM tero_usage WHERE period = :p"), {"p": period}
        ).first()
        return int(row[0]) if row else 0

    def add(self, period, input_tokens, output_tokens, cost_micro_usd):
        """Un solo INSERT ... ON CONFLICT: suma de forma atómica, sin leer antes."""
        db.session.execute(
            text(
                "INSERT INTO tero_usage (period, input_tokens, output_tokens, cost_micro_usd) "
                "VALUES (:p, :i, :o, :c) "
                "ON CONFLICT (period) DO UPDATE SET "
                "input_tokens = tero_usage.input_tokens + EXCLUDED.input_tokens, "
                "output_tokens = tero_usage.output_tokens + EXCLUDED.output_tokens, "
                "cost_micro_usd = tero_usage.cost_micro_usd + EXCLUDED.cost_micro_usd, "
                "updated_at = now()"
            ),
            {"p": period, "i": input_tokens, "o": output_tokens, "c": cost_micro_usd},
        )
        db.session.commit()
