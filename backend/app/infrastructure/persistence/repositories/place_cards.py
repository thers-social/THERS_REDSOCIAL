# Tarjeta mínima de lugares PÚBLICOS, compartida por mensajes (ADR-040 fase 4c) y
# publicaciones (fase 4d): una sola consulta para toda una página, nunca una por fila.

from sqlalchemy import text

from app.extensions import db


def fetch_place_cards(place_ids):
    """`{id: fila}` de los lugares públicos de `place_ids`. Los que no son públicos (o ya no
    existen) no aparecen: quien presenta decide cómo mostrarlos."""
    ids = [str(i) for i in set(place_ids) if i is not None]
    if not ids:
        return {}
    rows = db.session.execute(
        text(
            "SELECT p.id, p.name, p.municipality, p.department, c.slug AS category_slug, "
            "c.name AS category_name "
            "FROM places p JOIN place_categories c ON c.id = p.category_id "
            "WHERE p.id = ANY(CAST(:ids AS uuid[])) "
            "AND p.is_active AND p.verification_status IN ('verified', 'unverified') AND c.is_active"
        ),
        {"ids": ids},
    ).mappings()
    return {str(row["id"]): dict(row) for row in rows}
