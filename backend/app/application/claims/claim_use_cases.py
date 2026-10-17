# Casos de uso de los reclamos de negocio (ADR-040 fase 6). La validación de texto vive en
# `domain/claims/validators.py`; aquí se orquesta.
#
# Reglas: solo se reclama un lugar PÚBLICO que aún no tiene gestor; el documento es
# obligatorio, va a almacenamiento PRIVADO y se borra al resolver el reclamo (aprobar,
# rechazar o retirar); solo la moderación (`is_moderator`) resuelve y recibe una URL firmada
# de vida corta; aprobar crea la fila de gestor (rol distinto de moderador).

import logging
import uuid

from app.application.claims import claim_presenter
from app.application.places.place_card import to_place_card
from app.domain.claims import kinds, validators
from app.domain.claims.exceptions import (
    ClaimAlreadyResolvedError,
    ClaimLimitError,
    ClaimNotFoundError,
    ClaimsUnavailableError,
    InvalidClaimDataError,
    PlaceAlreadyManagedError,
)
from app.domain.media.storage import ImageTooLargeError, InvalidImageError
from app.domain.notifications import place_events
from app.domain.places.exceptions import PlaceNotFoundError

_logger = logging.getLogger(__name__)


def _discard(keys, storage):
    for key in keys:
        if not key:
            continue
        try:
            storage.delete(key)
        except Exception:  # noqa: BLE001 -- limpieza best-effort
            _logger.warning("Documento de reclamo huérfano: %s", key)


def _present_own(rows, repository):
    cards = repository.place_cards([row["place_id"] for row in rows])
    return [claim_presenter.present_claim(row, to_place_card(row["place_id"], cards)) for row in rows]


def create_claim(user_id, place_id, data, upload, repository, storage, process_document):
    """`upload` son los bytes del archivo (o None); `process_document` valida el contenido."""
    if storage is None:
        raise ClaimsUnavailableError()
    business_name = validators.parse_business_name(data.get("business_name"))
    contact_phone = validators.parse_phone(data.get("contact_phone"))
    message = validators.parse_message(data.get("message"))
    if not upload:
        raise InvalidClaimDataError("Adjunta un documento que respalde el reclamo")

    if not repository.public_place_exists(place_id):
        raise PlaceNotFoundError()
    if repository.is_manager(place_id, user_id) or repository.place_has_manager(place_id):
        raise PlaceAlreadyManagedError()
    if repository.count_pending(user_id) >= kinds.MAX_PENDING_PER_USER:
        raise ClaimLimitError()

    try:
        content, content_type, extension = process_document(upload)
    except ImageTooLargeError:
        raise InvalidClaimDataError("El documento supera los 5 MB")
    except InvalidImageError:
        raise InvalidClaimDataError("El documento debe ser una imagen JPG, PNG o WebP, o un PDF")

    key = f"claims/{uuid.uuid4().hex}.{extension}"
    storage.save(key, content, content_type)
    claim_id = repository.create_claim(
        place_id, user_id, business_name, contact_phone, message, key, content_type
    )
    if claim_id is None:
        _discard([key], storage)
        raise ClaimLimitError()
    return _present_own([repository.get_claim(claim_id)], repository)[0]


def list_own_claims(user_id, repository):
    return _present_own(repository.list_for_claimant(user_id, kinds.MAX_LIST), repository)


def withdraw_claim(claim_id, user_id, repository, storage):
    result = repository.withdraw(claim_id, user_id)
    if result is False:
        row = repository.get_claim(claim_id)
        if row is None or str(row["claimant_id"]) != str(user_id):
            raise ClaimNotFoundError()
        raise ClaimAlreadyResolvedError()
    if isinstance(result, str) and storage is not None:
        _discard([result], storage)
    return _present_own([repository.get_claim(claim_id)], repository)[0]


# ------------------------------------------------------------------ moderación


def review_list(status, limit, offset, repository):
    status = validators.parse_status(status)
    try:
        limit = min(int(limit), kinds.MAX_LIST) if limit not in (None, "") else 20
        offset = max(int(offset), 0) if offset not in (None, "") else 0
    except (TypeError, ValueError):
        raise InvalidClaimDataError("limit y offset deben ser números")
    if limit < 1:
        raise InvalidClaimDataError("limit debe ser mayor que cero")
    rows = repository.list_for_review(status, limit, offset)
    has_more = len(rows) > limit
    return [claim_presenter.present_for_review(row) for row in rows[:limit]], has_more


def review_get(claim_id, repository):
    row = repository.get_for_review(claim_id)
    if row is None:
        raise ClaimNotFoundError()
    return claim_presenter.present_for_review(row)


def document_url(claim_id, reviewer_id, repository, storage):
    if storage is None:
        raise ClaimsUnavailableError()
    row = repository.get_claim(claim_id)
    if row is None:
        raise ClaimNotFoundError()
    if row["status"] != kinds.CLAIM_PENDING or not row["document_key"]:
        # El documento se borra al resolver: ya no existe.
        raise ClaimAlreadyResolvedError()
    repository.record_document_view(claim_id, reviewer_id)
    return {
        "url": storage.signed_url(
            row["document_key"], row["document_content_type"], kinds.DOCUMENT_URL_TTL_SECONDS
        ),
        "content_type": row["document_content_type"],
        "expires_in": kinds.DOCUMENT_URL_TTL_SECONDS,
    }


def decide(claim_id, reviewer_id, approve, note, repository, storage):
    note = validators.parse_note(note, required=not approve)
    result = repository.decide(claim_id, reviewer_id, approve, note)
    if result is None:
        if repository.get_claim(claim_id) is None:
            raise ClaimNotFoundError()
        raise ClaimAlreadyResolvedError()
    if storage is not None:
        _discard(result["released_keys"], storage)
    # Sin actor: el aviso no dice qué cuenta de moderación decidió (ADR-040 §28).
    for affected_id, claimant_id, status in result["affected"]:
        repository.notify_people(
            place_events.CLAIM_DECIDED, result["place_id"], affected_id, [claimant_id], None,
            detail=status,
        )
    return claim_presenter.present_for_review(repository.get_for_review(claim_id))
