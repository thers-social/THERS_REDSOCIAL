"""Importa los lugares de El Salvador desde OpenStreetMap a THERS Places (ADR-043).

Fuente: la API Overpass pública. Los datos son de OpenStreetMap y están bajo la licencia ODbL
(https://www.openstreetmap.org/copyright): la atribución «© colaboradores de OpenStreetMap» debe
verse donde se muestren (el mapa ya la conserva) y lo importado queda marcado con
`source = 'osm'` y su identificador de OSM para poder separarlo. No se copia nada de Google Maps.

Cada lugar entra como `verified` por decisión del propietario (ADR-052; antes entraba como `unverified`). Es idempotente:
se identifica por `(osm_type, osm_id)` y solo se actualiza mientras ninguna persona lo haya verificado; uno que un
negocio reclamó o que moderación verificó, editó o desactivó **no se toca**.

Uso (desde `backend/`, con `DATABASE_URL` apuntando a la base):

    python scripts/import_osm_places.py                      # descarga e importa
    python scripts/import_osm_places.py --dry-run            # descarga y cuenta, sin escribir
    python scripts/import_osm_places.py --cache-dir <carpeta>  # guarda/reutiliza las respuestas
    python scripts/import_osm_places.py --allow-remote       # contra una base que no es local

Overpass es un servicio compartido: el script hace una consulta por grupo, espera entre ellas y
reintenta con pausa. No lo ejecutes en bucle.
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

# Permite correr el script desde `backend/` sin instalar el paquete.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text  # noqa: E402

from app import create_app  # noqa: E402
from app.domain.places import kinds, osm_mapping  # noqa: E402
from app.domain.places.write_validators import slugify  # noqa: E402
from app.extensions import db  # noqa: E402

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
USER_AGENT = "THERS-Places-import/1.0 (equipo THERS)"
_LOCAL_HOSTS = ("localhost", "127.0.0.1", "::1", "[::1]")
BATCH_SIZE = 500
PAUSE_BETWEEN_QUERIES = 8
RETRIES = 4

# Un grupo = una consulta. Los filtros son los de `osm_mapping`; aquí solo se agrupan para que cada
# respuesta sea de un tamaño razonable.
_GROUPS = {
    "comida-y-ocio": 'nwr["amenity"~"^(cafe|restaurant|fast_food|food_court|ice_cream|bar|pub|nightclub|biergarten|cinema|theatre|arts_centre)$"]["name"]',
    "salud": 'nwr["amenity"~"^(pharmacy|hospital|clinic|doctors|dentist)$"]["name"]',
    "servicios": 'nwr["amenity"~"^(fuel|university|college|school|kindergarten|bank|library|place_of_worship|police|fire_station|post_office|townhall|marketplace|community_centre|car_wash|veterinary)$"]["name"]',
    "comercios": 'nwr["shop"]["name"]',
    "turismo": 'nwr["tourism"~"^(hotel|hostel|guest_house|motel|apartment|camp_site|attraction|museum|gallery|theme_park|zoo|viewpoint)$"]["name"]',
    "ocio-al-aire-libre": 'nwr["leisure"~"^(park|garden|playground|nature_reserve|sports_centre|stadium|fitness_centre|golf_course)$"]["name"]',
}


def _query(selector):
    return (
        "[out:json][timeout:240];"
        'area["ISO3166-1"="SV"][admin_level=2]->.a;'
        f"({selector}(area.a););"
        "out center tags;"
    )


def fetch_group(name, selector, cache_dir):
    cache_file = os.path.join(cache_dir, f"{name}.json") if cache_dir else None
    if cache_file and os.path.exists(cache_file):
        with open(cache_file, encoding="utf-8") as handle:
            print(f"  [{name}] desde la caché")
            return json.load(handle)
    body = urllib.parse.urlencode({"data": _query(selector)}).encode()
    last_error = None
    for attempt in range(1, RETRIES + 1):
        request = urllib.request.Request(
            OVERPASS_URL, data=body, headers={"User-Agent": USER_AGENT, "Accept": "*/*"}
        )
        try:
            with urllib.request.urlopen(request, timeout=300) as response:
                payload = json.load(response)
            break
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            last_error = error
            wait = 20 * attempt
            print(f"  [{name}] intento {attempt}/{RETRIES} falló ({error}); espero {wait}s")
            time.sleep(wait)
    else:
        raise SystemExit(f"Overpass no respondió para «{name}»: {last_error}")
    if cache_file:
        os.makedirs(cache_dir, exist_ok=True)
        with open(cache_file, "w", encoding="utf-8") as handle:
            json.dump(payload, handle)
    return payload


def _is_local(database_url):
    host = (urllib.parse.urlparse(database_url).hostname or "").lower()
    return host in _LOCAL_HOSTS


def build_rows(payloads):
    """Lugares únicos (por tipo+id de OSM) listos para guardar, y cuántos se descartaron."""
    rows, seen, skipped = [], set(), 0
    for payload in payloads:
        for element in payload.get("elements", []):
            place = osm_mapping.place_from_element(element)
            if place is None:
                skipped += 1
                continue
            key = (place["osm_type"], place["osm_id"])
            if key in seen:
                continue
            seen.add(key)
            base = slugify(place["name"])[:140].strip("-") or "lugar"
            place["slug"] = f"{base}-{place['osm_type'][0]}{place['osm_id']}"
            rows.append(place)
    return rows, skipped


_UPSERT = text(
    """
    INSERT INTO places (
        name, slug, category_id, location, address, municipality, department, website,
        verification_status, source, coordinate_source, osm_type, osm_id, is_active
    ) VALUES (
        :name, :slug, :category_id, ST_SetSRID(ST_MakePoint(:longitude, :latitude), 4326)::geography,
        :address, :municipality, :department, :website,
        'verified', 'osm', 'imported', :osm_type, :osm_id, true
    )
    ON CONFLICT (osm_type, osm_id) WHERE osm_id IS NOT NULL DO UPDATE SET
        name = EXCLUDED.name,
        category_id = EXCLUDED.category_id,
        location = EXCLUDED.location,
        address = EXCLUDED.address,
        municipality = EXCLUDED.municipality,
        department = EXCLUDED.department,
        website = EXCLUDED.website,
        updated_at = now()
    WHERE places.source = 'osm' AND places.verification_status IN ('unverified', 'verified')
      AND places.verified_by_user_id IS NULL
    """
)


def save(rows):
    categories = {
        row.slug: row.id for row in db.session.execute(text("SELECT id, slug FROM place_categories"))
    }
    payload = []
    for row in rows:
        category_id = categories.get(row["category"])
        if category_id is None:
            raise SystemExit(f"La categoría «{row['category']}» no existe en place_categories.")
        payload.append({**row, "category_id": category_id})
    for start in range(0, len(payload), BATCH_SIZE):
        db.session.execute(_UPSERT, payload[start : start + BATCH_SIZE])
        db.session.commit()
        print(f"  guardados {min(start + BATCH_SIZE, len(payload))}/{len(payload)}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true", help="descarga y cuenta, sin escribir")
    parser.add_argument("--cache-dir", help="carpeta donde guardar/reutilizar las respuestas de Overpass")
    parser.add_argument("--allow-remote", action="store_true", help="permite una base que no es local")
    parser.add_argument("--only", choices=sorted(_GROUPS), help="importa solo un grupo")
    args = parser.parse_args()

    app = create_app()
    with app.app_context():
        url = app.config.get("SQLALCHEMY_DATABASE_URI") or os.environ.get("DATABASE_URL", "")
        if not args.dry_run and not _is_local(url) and not args.allow_remote:
            raise SystemExit(
                "La base no es local; esto escribiría miles de lugares. Si de verdad lo quieres, usa --allow-remote."
            )
        groups = {args.only: _GROUPS[args.only]} if args.only else _GROUPS
        payloads = []
        for index, (name, selector) in enumerate(groups.items()):
            cached = args.cache_dir and os.path.exists(os.path.join(args.cache_dir, f"{name}.json"))
            if index and not cached:
                time.sleep(PAUSE_BETWEEN_QUERIES)
            print(f"Descargando «{name}»…")
            payload = fetch_group(name, selector, args.cache_dir)
            print(f"  [{name}] {len(payload.get('elements', []))} elementos")
            payloads.append(payload)
        rows, skipped = build_rows(payloads)
        by_category = {}
        for row in rows:
            by_category[row["category"]] = by_category.get(row["category"], 0) + 1
        print(f"\nA importar: {len(rows)} lugares únicos ({skipped} descartados por no tener nombre o categoría).")
        for slug, count in sorted(by_category.items(), key=lambda item: -item[1]):
            print(f"  {slug:22s} {count}")
        if args.dry_run:
            print("\n--dry-run: no se escribió nada.")
            return
        save(rows)
        print(f"\nListo. Estado de los importados: {kinds.STATUS_VERIFIED}. © colaboradores de OpenStreetMap (ODbL).")


if __name__ == "__main__":
    main()
