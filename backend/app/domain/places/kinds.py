# Estados, fuentes de datos y límites de THERS Places
# (ADR-040-thers-places.md §4.2/§4.3). Solo tipos nativos de Python -- domain/ no
# importa Flask ni SQLAlchemy (BACKEND_ARCHITECTURE.md §7/§17).
#
# Se validan en la aplicación y con un CHECK en la tabla, no con un ENUM de
# PostgreSQL: agregar un valor nuevo no debería exigir una migración (mismo
# criterio que `domain/reports/kinds.py`, ADR-029/ADR-032).

# Estado de verificación del lugar. Solo `verified` (y activo) es público.
STATUS_PENDING = "pending"
STATUS_VERIFIED = "verified"
STATUS_NEEDS_REVIEW = "needs_review"
STATUS_REJECTED = "rejected"
STATUS_INACTIVE = "inactive"

VERIFICATION_STATUSES = (
    STATUS_PENDING,
    STATUS_VERIFIED,
    STATUS_NEEDS_REVIEW,
    STATUS_REJECTED,
    STATUS_INACTIVE,
)

# Procedencia del registro. Se conserva siempre: el catálogo propio debe poder
# convivir con fuentes externas sin perderla.
SOURCE_THERS_FIELD = "thers_field"
SOURCE_BUSINESS = "business"
SOURCE_COMMUNITY = "community"
SOURCE_OSM = "osm"
SOURCE_OFFICIAL = "official"

SOURCES = (
    SOURCE_THERS_FIELD,
    SOURCE_BUSINESS,
    SOURCE_COMMUNITY,
    SOURCE_OSM,
    SOURCE_OFFICIAL,
)

# Cómo se obtuvieron las coordenadas.
COORD_GPS = "gps"
COORD_MAP_SELECTED = "map_selected"
COORD_GEOCODED = "geocoded"
COORD_IMPORTED = "imported"

COORDINATE_SOURCES = (COORD_GPS, COORD_MAP_SELECTED, COORD_GEOCODED, COORD_IMPORTED)

# Motivos de un reporte de datos incorrectos (ADR-040, fase 2). Textos de la app, no
# de la base: la base solo los refuerza con un CHECK.
REPORT_WRONG_LOCATION = "wrong_location"
REPORT_WRONG_HOURS = "wrong_hours"
REPORT_WRONG_PHONE = "wrong_phone"
REPORT_CLOSED = "closed"
REPORT_DUPLICATE = "duplicate"
REPORT_WRONG_NAME = "wrong_name"
REPORT_INAPPROPRIATE = "inappropriate"
REPORT_OTHER = "other"

REPORT_REASONS = (
    REPORT_WRONG_LOCATION,
    REPORT_WRONG_HOURS,
    REPORT_WRONG_PHONE,
    REPORT_CLOSED,
    REPORT_DUPLICATE,
    REPORT_WRONG_NAME,
    REPORT_INAPPROPRIATE,
    REPORT_OTHER,
)

# Estado de un reporte. Quien modera solo puede cerrarlo como `resolved` o `dismissed`.
REPORT_OPEN = "open"
REPORT_REVIEWING = "reviewing"
REPORT_RESOLVED = "resolved"
REPORT_DISMISSED = "dismissed"

REPORT_STATUSES = (REPORT_OPEN, REPORT_REVIEWING, REPORT_RESOLVED, REPORT_DISMISSED)
REPORT_CLOSING_STATUSES = (REPORT_RESOLVED, REPORT_DISMISSED)
REPORT_PENDING_STATUSES = (REPORT_OPEN, REPORT_REVIEWING)

# Acciones que quedan en `admin_audit_log`.
AUDIT_PLACE_CREATED = "place_created"
AUDIT_PLACE_UPDATED = "place_updated"
AUDIT_PLACE_STATUS_CHANGED = "place_status_changed"
AUDIT_PLACE_REPORT_RESOLVED = "place_report_resolved"

# Longitudes máximas (iguales a las columnas de `places`).
MAX_NAME_LENGTH = 160
MAX_DESCRIPTION_LENGTH = 2000
MAX_ADDRESS_LENGTH = 255
MAX_AREA_LENGTH = 100
MAX_PHONE_LENGTH = 40
MAX_WEBSITE_LENGTH = 255
MAX_REPORT_DETAILS_LENGTH = 500
MAX_NOTE_LENGTH = 500

# Búsqueda de texto.
MIN_SEARCH_LENGTH = 2
MAX_SEARCH_LENGTH = 80

# Límites de las consultas (ADR-040 §4.3).
DEFAULT_RADIUS_METERS = 5000
MAX_RADIUS_METERS = 50000
DEFAULT_LIMIT = 20
MAX_LIMIT = 50
MAX_OFFSET = 10000
