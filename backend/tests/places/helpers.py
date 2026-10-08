# Utilidades de las pruebas de THERS Places (ADR-040).
#
# Los lugares se insertan con SQL `ST_*` explícito, igual que el repositorio y el
# seed: así las pruebas no dependen de ninguna librería geográfica de Python.

from sqlalchemy import text

from app.extensions import db

# Mismo punto de referencia y misma constante que `scripts/seed_places.py`.
REF_LAT = 13.6929
REF_LNG = -89.2182
METERS_PER_DEGREE_LAT = 110636.6


def north_of_reference(meters):
    """Latitud de un punto a `meters` metros al norte de la referencia."""
    return REF_LAT + meters / METERS_PER_DEGREE_LAT


_counter = {"n": 0}


def insert_place(
    name="Lugar de prueba",
    lat=REF_LAT,
    lng=REF_LNG,
    category="cafes",
    status="verified",
    active=True,
    slug=None,
    source="thers_field",
    coordinate_source="gps",
    **extra,
):
    """Inserta un lugar y devuelve su id (str). Debe llamarse dentro de un
    `app.app_context()`."""
    if slug is None:
        _counter["n"] += 1
        slug = f"test-place-{_counter['n']:06d}"
    row = db.session.execute(
        text(
            """
            INSERT INTO places (
                name, slug, description, category_id, location, address, municipality,
                department, phone, website, verification_status, source, coordinate_source,
                is_active
            )
            SELECT :name, :slug, :description, c.id,
                   ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography,
                   :address, :municipality, :department, :phone, :website,
                   :status, :source, :coordinate_source, :active
            FROM place_categories c WHERE c.slug = :category
            RETURNING id
            """
        ),
        {
            "name": name, "slug": slug, "category": category, "lat": lat, "lng": lng,
            "status": status, "source": source, "coordinate_source": coordinate_source,
            "active": active, "description": extra.get("description"),
            "address": extra.get("address"), "municipality": extra.get("municipality"),
            "department": extra.get("department"), "phone": extra.get("phone"),
            "website": extra.get("website"),
        },
    ).first()
    db.session.commit()
    return str(row[0])


# --- Usuarios autenticados (reutiliza los auxiliares de las pruebas de reportes) ---


def make_users(app, client, with_moderator=False):
    """Registra personas y devuelve `{nombre: (token, user_id)}`. `mod` es moderador."""
    from tests.test_moderation import _make_moderator
    from tests.test_reports import _register_and_login

    users = {"ana": _register_and_login(client, "ana"), "beto": _register_and_login(client, "beto")}
    if with_moderator:
        users["mod"] = _register_and_login(client, "moderadora")
        _make_moderator(app, users["mod"][1])
    return users


def auth(token):
    return {"Authorization": f"Bearer {token}"}
