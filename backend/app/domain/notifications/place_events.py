# Eventos de THERS Places que generan un aviso (ADR-040 fase 12). Constantes puras: el texto que
# se muestra lo pone cada cliente; el servidor nunca guarda texto libre de nadie en un aviso.

RESERVATION_NEW = "place_reservation_new"
RESERVATION_DECIDED = "place_reservation_decided"  # detail: confirmed | declined
RESERVATION_CANCELLED = "place_reservation_cancelled"
QUOTE_NEW = "place_quote_new"
QUOTE_DECIDED = "place_quote_decided"  # detail: accepted | rejected
PLAN_INVITE = "place_plan_invite"
CLAIM_DECIDED = "place_claim_decided"  # detail: approved | rejected; sin actor
REVIEW_REPLY = "place_review_reply"

PLACE_EVENT_TYPES = (
    RESERVATION_NEW,
    RESERVATION_DECIDED,
    RESERVATION_CANCELLED,
    QUOTE_NEW,
    QUOTE_DECIDED,
    PLAN_INVITE,
    CLAIM_DECIDED,
    REVIEW_REPLY,
)
