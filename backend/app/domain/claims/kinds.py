# Constantes de los reclamos de negocio (ADR-040 fase 6).

CLAIM_PENDING = "pending"
CLAIM_APPROVED = "approved"
CLAIM_REJECTED = "rejected"
CLAIM_WITHDRAWN = "withdrawn"
CLAIM_STATUSES = (CLAIM_PENDING, CLAIM_APPROVED, CLAIM_REJECTED, CLAIM_WITHDRAWN)

MAX_BUSINESS_NAME_LENGTH = 160
MAX_PHONE_LENGTH = 40
MAX_MESSAGE_LENGTH = 500
MAX_NOTE_LENGTH = 500

# Reclamos pendientes simultáneos por persona (frena el barrido masivo de lugares).
MAX_PENDING_PER_USER = 3

MAX_DOCUMENT_BYTES = 5 * 1024 * 1024
PDF_CONTENT_TYPE = "application/pdf"
DOCUMENT_URL_TTL_SECONDS = 300

MAX_LIST = 50

# Acciones que quedan en `admin_audit_log`.
AUDIT_CLAIM_APPROVED = "place_claim_approved"
AUDIT_CLAIM_REJECTED = "place_claim_rejected"
AUDIT_CLAIM_DOCUMENT_VIEWED = "place_claim_document_viewed"
