# Contador de gasto de IA por propósito (ADR-045 §2.3). Tabla `ai_usage`, clave (mes, propósito).
# NO toca `tero_usage`: el contador de Tero es suyo.
#
# Igual que el de Tero: PostgreSQL y no memoria del proceso (varios workers compartirían el tope) y
# un solo INSERT ... ON CONFLICT para sumar de forma atómica.

from sqlalchemy import text

from app.extensions import db


class SQLAlchemyAiUsageRepository:
    def spent_micro(self, period, purpose):
        row = db.session.execute(
            text("SELECT cost_micro_usd FROM ai_usage WHERE period = :p AND purpose = :u"),
            {"p": period, "u": purpose},
        ).first()
        return int(row[0]) if row else 0

    def add(self, period, purpose, input_tokens, output_tokens, cost_micro_usd):
        db.session.execute(
            text(
                "INSERT INTO ai_usage (period, purpose, input_tokens, output_tokens, cost_micro_usd) "
                "VALUES (:p, :u, :i, :o, :c) "
                "ON CONFLICT (period, purpose) DO UPDATE SET "
                "input_tokens = ai_usage.input_tokens + EXCLUDED.input_tokens, "
                "output_tokens = ai_usage.output_tokens + EXCLUDED.output_tokens, "
                "cost_micro_usd = ai_usage.cost_micro_usd + EXCLUDED.cost_micro_usd, "
                "updated_at = now()"
            ),
            {"p": period, "u": purpose, "i": input_tokens, "o": output_tokens, "c": cost_micro_usd},
        )
        db.session.commit()
