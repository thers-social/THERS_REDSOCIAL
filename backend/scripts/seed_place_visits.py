"""Siembra visitas de DEMOSTRACIÓN para las estadísticas del panel de negocio (ADR-040 §33).

Son números INVENTADOS, no actividad de personas. Sirven para ver el panel con datos, y nada más:
ninguna cifra, tasa de conversión ni captura que salga de aquí es un resultado. Si se enseñan
(exposición, capturas), hay que decir que son datos de demostración.

Solo toca los contadores de los lugares SEMBRADOS (slug `seed-*` / `bulk-*`, los de
`seed_places.py`): nunca un lugar real. Como los lugares sembrados no existen en producción,
los contadores de demostración tampoco. Se niega a correr si la base no es local, salvo con
`--allow-remote` (que NO debe usarse contra producción).

Es idempotente: se puede correr varias veces y deja el mismo resultado.

Uso (desde `backend/`, con `DATABASE_URL` apuntando a la base):

    python scripts/seed_place_visits.py              # 90 días de visitas de demostración
    python scripts/seed_place_visits.py --days 30    # solo los últimos 30 días
    python scripts/seed_place_visits.py --reset      # borra los contadores de los lugares sembrados
"""

import argparse
import os
import random
import sys
from datetime import datetime, timedelta, timezone

# Permite correr el script desde `backend/` sin instalar el paquete.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text  # noqa: E402

from app import create_app  # noqa: E402
from app.extensions import db  # noqa: E402

from seed_places import _check_local  # noqa: E402  (mismo guardia de «base local»)

UTC_OFFSET_HOURS = -6  # El Salvador: los contadores son por día local (como las estadísticas)
_SEEDED = "(slug LIKE 'seed-%' OR slug LIKE 'bulk-%')"


def _plan(rng, popularity):
    """Visitas de un día: la gente mira mucho, llama poco y pide ruta algo más."""
    views = max(0, int(rng.gauss(popularity, popularity * 0.35)))
    return {
        "view": views,
        "phone": int(views * rng.uniform(0.03, 0.08)),
        "website": int(views * rng.uniform(0.02, 0.06)),
        "directions": int(views * rng.uniform(0.06, 0.15)),
    }


def seed(days):
    today = (datetime.now(timezone.utc) + timedelta(hours=UTC_OFFSET_HOURS)).date()
    rng = random.Random(16)  # fijo: el mismo resultado en cada corrida
    places = db.session.execute(
        text("SELECT id, slug FROM places WHERE slug LIKE 'seed-%' ORDER BY slug")
    ).all()
    rows = 0
    for index, (place_id, _slug) in enumerate(places):
        popularity = max(2, 28 - index * 4)  # los primeros lugares son los más visitados
        for offset in range(days):
            day = today - timedelta(days=offset)
            weekend_boost = 1.4 if day.weekday() >= 4 else 1.0
            for event, count in _plan(rng, popularity * weekend_boost).items():
                if count <= 0:
                    continue
                db.session.execute(
                    text(
                        "INSERT INTO place_visit_counts (place_id, day, event, count) "
                        "VALUES (:p, :d, :e, :c) "
                        "ON CONFLICT (place_id, day, event) DO UPDATE SET count = EXCLUDED.count"
                    ),
                    {"p": place_id, "d": day, "e": event, "c": count},
                )
                rows += 1
    db.session.commit()
    return len(places), rows


def reset():
    result = db.session.execute(
        text(f"DELETE FROM place_visit_counts WHERE place_id IN (SELECT id FROM places WHERE {_SEEDED})")
    )
    db.session.commit()
    return result.rowcount


def main():
    parser = argparse.ArgumentParser(description="Siembra visitas de DEMOSTRACIÓN de THERS Places.")
    parser.add_argument("--days", type=int, default=90, help="cuántos días hacia atrás (1 a 365)")
    parser.add_argument("--reset", action="store_true", help="borra los contadores de los lugares sembrados")
    parser.add_argument("--allow-remote", action="store_true", help="permite una base no local")
    args = parser.parse_args()
    if not 1 <= args.days <= 365:
        sys.exit("--days debe estar entre 1 y 365")

    app = create_app()
    url = app.config["SQLALCHEMY_DATABASE_URI"]
    if not _check_local(url) and not args.allow_remote:
        sys.exit("La base no es local: estos datos son de DEMOSTRACIÓN y no deben ir a producción. "
                 "Si de verdad lo quieres, usa --allow-remote.")

    with app.app_context():
        if args.reset:
            print(f"Contadores borrados: {reset()}")
            return
        places, rows = seed(args.days)
        if places == 0:
            sys.exit("No hay lugares sembrados: corre antes `python scripts/seed_places.py`.")
        print(f"Lugares con visitas de demostración: {places} · contadores: {rows}")
        print("Recuerda: son números inventados, no actividad de personas.")


if __name__ == "__main__":
    main()
