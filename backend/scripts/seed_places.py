"""Siembra lugares de PRUEBA para THERS Places (ADR-040, fase 1).

Datos inventados para desarrollo y pruebas: no copian Google Maps ni ninguna otra
fuente. NUNCA deben ir a producción (ADR-040 R7). Por eso el script se niega a correr
si la base no es local, salvo con `--allow-remote`.

Es idempotente: cada lugar se identifica por su `slug` y se actualiza si ya existe.

Uso (desde `backend/`, con `DATABASE_URL` apuntando a la base):

    python scripts/seed_places.py              # ~16 lugares controlados
    python scripts/seed_places.py --bulk 1000  # además, 1000 lugares para pruebas de rendimiento
    python scripts/seed_places.py --reset      # borra los lugares sembrados (slug seed-*/bulk-*)

Punto de referencia de las distancias: centro de San Salvador (13.6929, -89.2182).
"""

import argparse
import math
import os
import random
import sys

# Permite correr el script desde `backend/` sin instalar el paquete.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text  # noqa: E402

from app import create_app  # noqa: E402
from app.extensions import db  # noqa: E402

REF_LAT = 13.6929
REF_LNG = -89.2182

# Metros por grado de latitud a ~13.7° N (arco de meridiano, elipsoide WGS 84).
METERS_PER_DEGREE_LAT = 110636.6

_LOCAL_HOSTS = ("localhost", "127.0.0.1", "::1", "[::1]")


def north_of_reference(meters):
    """Latitud de un punto a `meters` metros al norte de la referencia (misma longitud)."""
    return REF_LAT + meters / METERS_PER_DEGREE_LAT


# (slug, nombre, categoría, lat, lng, estado, activo, fuente, coordenadas, extras)
# Los extras opcionales que faltan quedan en NULL a propósito.
_CONTROLLED = [
    # Distancias conocidas (A ~500 m, B ~2 km, C ~10 km, al norte de la referencia).
    ("seed-cafe-aurora", "Café Aurora", "cafes", north_of_reference(500), REF_LNG,
     "verified", True, "thers_field", "gps",
     {"address": "Colonia Escalón, San Salvador", "municipality": "San Salvador",
      "department": "San Salvador", "phone": "+503 2222-0001",
      "description": "Cafetería de prueba con terraza."}),
    ("seed-pupuseria-nandu", "Pupusería La Niña Ñandú", "restaurantes", north_of_reference(2000), REF_LNG,
     "verified", True, "community", "map_selected",
     {"address": "Calle Principal #12, San Salvador", "municipality": "San Salvador"}),
    ("seed-parque-lejano", "Parque Cuscatlán del Norte", "parques", north_of_reference(10000), REF_LNG,
     "verified", True, "official", "imported", {"municipality": "Apopa"}),
    # Otras categorías y direcciones alrededor de la referencia.
    ("seed-farmacia-jose", "Farmacia Económica José Ñ", "farmacias", REF_LAT - 0.004, REF_LNG + 0.004,
     "verified", True, "business", "geocoded", {"phone": "+503 2222-0002"}),
    ("seed-gasolinera-sur", "Gasolinera Ruta Sur", "gasolineras", REF_LAT - 0.02, REF_LNG - 0.001,
     "verified", True, "thers_field", "gps", {}),
    ("seed-super-central", "Supermercado Central", "supermercados", REF_LAT + 0.001, REF_LNG - 0.01,
     "verified", True, "official", "imported", {"website": "https://example.com/super-central"}),
    ("seed-hospital-sur", "Hospital Regional del Sur", "hospitales", REF_LAT - 0.03, REF_LNG + 0.01,
     "verified", True, "official", "imported", {"municipality": "San Marcos"}),
    ("seed-universidad-norte", "Universidad Tecnológica del Norte", "universidades", REF_LAT + 0.015, REF_LNG + 0.012,
     "verified", True, "official", "imported", {}),
    ("seed-mall-oriente", "Centro Comercial Oriente", "centros-comerciales", REF_LAT + 0.002, REF_LNG + 0.03,
     "verified", True, "business", "map_selected", {}),
    ("seed-cine-poniente", "Cine Poniente", "entretenimiento", REF_LAT - 0.001, REF_LNG - 0.03,
     "verified", True, "business", "gps", {}),
    ("seed-hotel-centro", "Hotel Plaza del Árbol", "hoteles", REF_LAT + 0.0005, REF_LNG + 0.0005,
     "verified", True, "business", "gps", {"phone": "+503 2222-0003"}),
    # Nombre largo (límite de la columna: 160) y caracteres especiales.
    ("seed-nombre-largo", "Restaurante Tradicional de la Abuela Doña María Concepción de los Ángeles "
     "Hernández Quiñónez, Cocina Salvadoreña Auténtica y Postres Caseros — Desde 1952", "restaurantes",
     REF_LAT + 0.006, REF_LNG - 0.006, "verified", True, "community", "map_selected", {}),
    # No públicos: no deben aparecer en ninguna consulta pública.
    ("seed-pendiente", "Panadería Pendiente", "restaurantes", REF_LAT + 0.0007, REF_LNG,
     "pending", True, "community", "map_selected", {}),
    ("seed-en-revision", "Librería En Revisión", "otros", REF_LAT + 0.0008, REF_LNG,
     "needs_review", True, "community", "map_selected", {}),
    ("seed-rechazado", "Local Rechazado", "otros", REF_LAT + 0.0009, REF_LNG,
     "rejected", True, "community", "map_selected", {}),
    ("seed-inactivo", "Café Cerrado Inactivo", "cafes", REF_LAT + 0.0006, REF_LNG,
     "verified", False, "thers_field", "gps", {}),
]


def _check_local(url):
    host = url.split("@")[-1].split("/")[0].rsplit(":", 1)[0]
    return host in _LOCAL_HOSTS


def _upsert(slug, name, category_slug, lat, lng, status, active, source, coord_source, extras):
    db.session.execute(
        text(
            """
            INSERT INTO places (
                name, slug, description, category_id, location, address, municipality,
                department, phone, website, verification_status, source, coordinate_source,
                is_active, last_verified_at
            )
            SELECT :name, :slug, :description, c.id,
                   ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography,
                   :address, :municipality, :department, :phone, :website,
                   CAST(:status AS text), :source, :coord_source, :active,
                   CASE WHEN CAST(:status AS text) = 'verified' THEN now() END
            FROM place_categories c WHERE c.slug = :category
            ON CONFLICT (slug) DO UPDATE SET
                name = EXCLUDED.name, description = EXCLUDED.description,
                category_id = EXCLUDED.category_id, location = EXCLUDED.location,
                address = EXCLUDED.address, municipality = EXCLUDED.municipality,
                department = EXCLUDED.department, phone = EXCLUDED.phone,
                website = EXCLUDED.website, verification_status = EXCLUDED.verification_status,
                source = EXCLUDED.source, coordinate_source = EXCLUDED.coordinate_source,
                is_active = EXCLUDED.is_active, last_verified_at = EXCLUDED.last_verified_at,
                updated_at = now()
            """
        ),
        {
            "name": name, "slug": slug, "category": category_slug, "lat": lat, "lng": lng,
            "status": status, "active": active, "source": source, "coord_source": coord_source,
            "description": extras.get("description"), "address": extras.get("address"),
            "municipality": extras.get("municipality"), "department": extras.get("department"),
            "phone": extras.get("phone"), "website": extras.get("website"),
        },
    )


def seed_controlled():
    for row in _CONTROLLED:
        _upsert(*row)
    db.session.commit()
    return len(_CONTROLLED)


def seed_bulk(count):
    """`count` lugares verificados repartidos en ~30 km alrededor de la referencia.
    Determinista (semilla fija): la misma corrida produce los mismos puntos."""
    rng = random.Random(42)
    categories = [r[0] for r in db.session.execute(text("SELECT slug FROM place_categories")).all()]
    for i in range(count):
        # Distribución uniforme en un disco de 30 km.
        distance = 30000 * math.sqrt(rng.random())
        angle = rng.uniform(0, 2 * math.pi)
        lat = REF_LAT + (distance * math.cos(angle)) / METERS_PER_DEGREE_LAT
        lng = REF_LNG + (distance * math.sin(angle)) / (
            METERS_PER_DEGREE_LAT * math.cos(math.radians(REF_LAT))
        )
        _upsert(
            f"bulk-{i:05d}", f"Lugar de prueba {i:05d}", rng.choice(categories),
            round(lat, 6), round(lng, 6), "verified", True, "thers_field", "gps", {},
        )
    db.session.commit()
    return count


def reset():
    result = db.session.execute(
        text("DELETE FROM places WHERE slug LIKE 'seed-%' OR slug LIKE 'bulk-%'")
    )
    db.session.commit()
    return result.rowcount


def main():
    parser = argparse.ArgumentParser(description="Siembra lugares de prueba de THERS Places.")
    parser.add_argument("--bulk", type=int, default=0, help="además, N lugares para rendimiento")
    parser.add_argument("--reset", action="store_true", help="borra los lugares sembrados")
    parser.add_argument("--allow-remote", action="store_true", help="permite una base no local")
    args = parser.parse_args()

    app = create_app()
    url = app.config["SQLALCHEMY_DATABASE_URI"]
    if not _check_local(url) and not args.allow_remote:
        sys.exit("La base no es local: estos datos son de PRUEBA y no deben ir a producción. "
                 "Si de verdad lo quieres, usa --allow-remote.")

    with app.app_context():
        if args.reset:
            print(f"Lugares borrados: {reset()}")
            return
        print(f"Lugares controlados: {seed_controlled()}")
        if args.bulk:
            print(f"Lugares de rendimiento: {seed_bulk(args.bulk)}")


if __name__ == "__main__":
    main()
