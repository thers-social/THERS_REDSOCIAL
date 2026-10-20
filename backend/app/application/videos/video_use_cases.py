# Casos de uso de Reels (ADR-043, ADR-043-A). Reciben repositorios y puertos por parámetro.
#
# Garantías (cada una tiene su prueba):
#   * D3: solo las cuentas de la lista de prueba pueden subir; el resto recibe un 404 como si el
#     módulo no existiera.
#   * Un video nunca se ve sin `ready` Y `approved`; nace `pending`.
#   * Webhooks: firma HMAC con marca de tiempo, idempotentes por id de evento, tolerantes al orden y
#     a llegar antes de que exista el video. La duración se comprueba al llegar `asset.ready`.
#   * El borrado quita la fila y encola el del asset de Mux en la misma transacción (con reintentos).

import json
import logging
import math
import time
import uuid
from datetime import datetime, timezone

from app.application.media.media_url import media_url
from app.domain.automation import events as signing
from app.domain.videos import rules

_logger = logging.getLogger(__name__)

PLAYBACK_TTL_SECONDS = 3600
PAGE_MAX = 30
DEFERRED_MAX_AGE_HOURS = 48


class InvalidSignatureError(Exception):
    pass


class InvalidWebhookError(Exception):
    pass


def _now():
    return datetime.now(timezone.utc)


def _iso(value):
    return value.isoformat() if value else None


# --- Presentación ----------------------------------------------------------------------------------


def present_video(row, viewer_id, signer=None, engagement=None):
    """Forma pública. Nunca expone ids de Mux ni el estado interno a terceros. `engagement` (ADR-055)
    trae contadores y el estado del espectador; sin él, valen cero y `false`."""
    engagement = engagement or {}
    is_owner = str(row["owner_id"]) == str(viewer_id)
    watchable = row["status"] == rules.READY and row["moderation_status"] == "approved"
    playback = None
    if watchable and signer is not None and row["mux_playback_id"]:
        token = signer.sign(row["mux_playback_id"], PLAYBACK_TTL_SECONDS)
        playback = {"hls_url": signer.hls_url(row["mux_playback_id"], token),
                    "expires_in": PLAYBACK_TTL_SECONDS}
    video = {
        "id": str(row["id"]),
        "author": {
            "id": str(row["owner_id"]), "username": row["owner_username"],
            "name": row["owner_name"], "avatar_url": media_url(row["owner_avatar_path"]),
            "is_following": bool(engagement.get("following_author", False)),
        },
        "likes_count": int(engagement.get("likes_count", 0)),
        "comments_count": int(engagement.get("comments_count", 0)),
        "liked_by_me": bool(engagement.get("liked_by_me", False)),
        "saved_by_me": bool(engagement.get("saved_by_me", False)),
        "caption": row["caption"],
        "duration_ms": row["duration_ms"],
        "width": row["width"],
        "height": row["height"],
        "created_at": _iso(row["created_at"]),
        "playback": playback,
    }
    if is_owner:
        # Solo quien lo subió ve en qué paso va y por qué no se publica.
        video["status"] = row["status"]
        video["moderation_status"] = row["moderation_status"]
        if row["failure_reason"]:
            video["failure_reason"] = row["failure_reason"]
    return video


# --- Subida ------------------------------------------------------------------------------------------


def create_upload(
    owner_id, caption, idempotency_key, repository, mux, allowlist, cors_origin, human_review_only=False
):
    username = repository.get_owner_username(owner_id)
    if not rules.may_upload(username, allowlist, human_review_only):
        raise rules.VideoUploadNotAllowedError()
    caption = rules.normalize_caption(caption)
    key = rules.normalize_idempotency_key(idempotency_key)
    if mux is None:
        raise rules.ProviderUnavailableError("not_configured")

    row, created = repository.reserve(owner_id, caption, key)
    if not created:
        # Reintento con la misma clave: NO se abre otra subida. La URL de subida solo se entrega en
        # la primera respuesta (no se guarda); si se perdió, se reserva otra con una clave nueva.
        repository.commit()
        return {"id": str(row["id"]), "status": row["status"], "upload_url": None, "created": False}

    try:
        upload = mux.create_direct_upload(row["id"], cors_origin)
    except rules.ProviderUnavailableError:
        repository.mark_failed(row["id"], "provider_unavailable")
        repository.commit()
        raise
    repository.mark_uploading(row["id"], upload["upload_id"])
    repository.commit()
    return {"id": str(row["id"]), "status": rules.UPLOADING, "upload_url": upload["url"], "created": True}


# --- Lectura ------------------------------------------------------------------------------------------


def get_video(video_id, viewer_id, repository, signer):
    row = repository.get_visible(video_id, viewer_id)
    if row is None:
        raise rules.VideoNotFoundError()
    return _present_all([row], viewer_id, repository, signer)[0]


def _present_all(rows, viewer_id, repository, signer):
    """Presenta varios videos con una sola consulta de contadores."""
    stats = repository.engagement([r["id"] for r in rows], viewer_id)
    return [present_video(r, viewer_id, signer, stats.get(str(r["id"]))) for r in rows]


def _page(limit_raw, offset_raw):
    try:
        limit = int(limit_raw) if limit_raw not in (None, "") else 10
        offset = int(offset_raw) if offset_raw not in (None, "") else 0
    except (TypeError, ValueError):
        raise rules.VideoInvalidError("limit y offset deben ser números")
    if not 1 <= limit <= PAGE_MAX or offset < 0:
        raise rules.VideoInvalidError(f"limit debe estar entre 1 y {PAGE_MAX}")
    return limit, offset


def list_videos(viewer_id, author_raw, limit_raw, offset_raw, repository, signer):
    author = None
    if author_raw not in (None, ""):
        try:
            author = str(uuid.UUID(str(author_raw)))
        except ValueError:
            raise rules.VideoInvalidError("author debe ser un identificador válido")
    limit, offset = _page(limit_raw, offset_raw)
    rows, has_more = repository.list_visible(viewer_id, author, limit, offset)
    return {"videos": _present_all(rows, viewer_id, repository, signer), "has_more": has_more}


def list_saved(viewer_id, limit_raw, offset_raw, repository, signer):
    limit, offset = _page(limit_raw, offset_raw)
    rows, has_more = repository.list_saved(viewer_id, limit, offset)
    return {"videos": _present_all(rows, viewer_id, repository, signer), "has_more": has_more}


def list_mine(owner_id, repository, signer):
    return {"videos": _present_all(repository.list_mine(owner_id, 30), owner_id, repository, signer)}


# --- Interacciones (ADR-055) ----------------------------------------------------------------------


def _interactable(video_id, viewer_id, repository):
    """El video si se puede ver Y está publicado (listo y aprobado). Si no, el mismo 404 de siempre:
    no se da «me gusta», no se guarda ni se comenta lo que no se puede ver o aún no se publicó."""
    row = repository.get_visible(video_id, viewer_id)
    if row is None or row["status"] != rules.READY or row["moderation_status"] != "approved":
        raise rules.VideoNotFoundError()
    return row


def _counts(video_id, viewer_id, repository):
    return repository.engagement([video_id], viewer_id)[str(video_id)]


def set_like(video_id, viewer_id, liked, repository):
    _interactable(video_id, viewer_id, repository)
    (repository.add_like if liked else repository.remove_like)(video_id, viewer_id)
    repository.commit()
    stats = _counts(video_id, viewer_id, repository)
    return {"liked": stats["liked_by_me"], "likes_count": int(stats["likes_count"])}


def set_save(video_id, viewer_id, saved, repository):
    _interactable(video_id, viewer_id, repository)
    (repository.add_save if saved else repository.remove_save)(video_id, viewer_id)
    repository.commit()
    return {"saved": _counts(video_id, viewer_id, repository)["saved_by_me"]}


def present_comment(row, viewer_id, video_owner_id):
    return {
        "id": str(row["id"]),
        "video_id": str(row["video_id"]),
        "content": row["content"],
        "created_at": _iso(row["created_at"]),
        "author": {
            "id": str(row["author_id"]), "username": row["author_username"],
            "name": row["author_name"], "avatar_url": media_url(row["author_avatar_path"]),
        },
        # Quien lo escribió o la persona dueña del Reel pueden borrarlo.
        "can_delete": str(viewer_id) in (str(row["author_id"]), str(video_owner_id)),
    }


def list_comments(video_id, viewer_id, limit_raw, offset_raw, repository):
    video = _interactable(video_id, viewer_id, repository)
    limit, offset = _page(limit_raw, offset_raw)
    rows, has_more = repository.list_comments(video_id, viewer_id, limit, offset)
    return {"comments": [present_comment(r, viewer_id, video["owner_id"]) for r in rows],
            "has_more": has_more}


def create_comment(video_id, viewer_id, content, repository):
    video = _interactable(video_id, viewer_id, repository)
    content = rules.normalize_comment(content)
    created = repository.add_comment(video_id, viewer_id, content)
    repository.commit()
    row = repository.get_comment_with_author(created["id"])
    return present_comment(row, viewer_id, video["owner_id"])


def delete_comment(video_id, comment_id, viewer_id, repository):
    video = _interactable(video_id, viewer_id, repository)
    if not repository.delete_comment(comment_id, video_id, viewer_id, video["owner_id"]):
        repository.rollback()
        raise rules.VideoCommentNotFoundError()
    repository.commit()
    return {"deleted": True}


def delete_video(video_id, owner_id, repository):
    if not repository.delete(video_id, owner_id):
        repository.rollback()
        raise rules.VideoNotFoundError()
    repository.commit()
    return {"deleted": True}


# --- Webhooks de Mux --------------------------------------------------------------------------------


def _seconds_to_ms(value):
    try:
        return int(round(float(value) * 1000))
    except (TypeError, ValueError, OverflowError):
        return None


def _video_for_asset(repository, data):
    """El video de un evento de asset: por asset, o por nuestro `passthrough` (id del video)."""
    row = repository.find_by_asset(data.get("id")) if data.get("id") else None
    if row is None and data.get("passthrough"):
        try:
            row = repository.get(str(uuid.UUID(str(data["passthrough"]))))
        except ValueError:
            row = None
    return row


def _signed_playback_id(data):
    for item in data.get("playback_ids") or []:
        if isinstance(item, dict) and item.get("policy") == "signed" and item.get("id"):
            return item["id"]
    return None  # sin reproducción FIRMADA no se publica


def _dimensions(data):
    for track in data.get("tracks") or []:
        if isinstance(track, dict) and track.get("type") == "video":
            return track.get("max_width"), track.get("max_height")
    return None, None


def apply_event(repository, event_type, data):
    """Aplica un evento ya validado. Devuelve `processed`, `deferred` o `ignored`. No confirma."""
    if event_type == "video.upload.asset_created":
        video = repository.find_by_upload(data.get("id"))
        if video is None:
            return "deferred"
        if data.get("asset_id"):
            repository.mark_processing(video["id"], data["asset_id"])
        return "processed"

    if event_type == "video.asset.ready":
        video = _video_for_asset(repository, data)
        if video is None:
            return "deferred"
        # Puede llegar antes que `upload.asset_created`: se completa el paso intermedio.
        if video["status"] == rules.UPLOADING:
            repository.mark_processing(video["id"], data.get("id"))
        duration_ms = _seconds_to_ms(data.get("duration"))
        playback_id = _signed_playback_id(data)
        if duration_ms is None or duration_ms < 0 or duration_ms > rules.MAX_DURATION_MS:
            repository.mark_blocked(video["id"], "duration_exceeded")
            if data.get("id"):
                repository.enqueue_external_deletion("mux", data["id"])
            return "processed"
        if playback_id is None:
            repository.mark_blocked(video["id"], "no_signed_playback")
            if data.get("id"):
                repository.enqueue_external_deletion("mux", data["id"])
            return "processed"
        width, height = _dimensions(data)
        repository.mark_ready(video["id"], playback_id, duration_ms, width, height)
        return "processed"

    if event_type == "video.asset.errored":
        video = _video_for_asset(repository, data)
        if video is None:
            return "deferred"
        repository.mark_failed(video["id"], "asset_errored")
        if data.get("id"):
            repository.enqueue_external_deletion("mux", data["id"])
        return "processed"

    if event_type in ("video.upload.errored", "video.upload.cancelled"):
        video = repository.find_by_upload(data.get("id"))
        if video is None:
            return "deferred"
        repository.mark_failed(video["id"], "upload_failed")
        return "processed"

    return "ignored"


def handle_webhook(raw_body, signature_header, secret, repository, now_ts=None):
    """Valida la firma y aplica el evento. Idempotente. Lanza `InvalidSignatureError` o
    `InvalidWebhookError`; todo lo demás confirma y devuelve un resumen."""
    if not signing.verify(secret, signature_header, raw_body, now_ts if now_ts is not None else time.time()):
        raise InvalidSignatureError()
    try:
        payload = json.loads(raw_body)
        event_id, event_type, data = payload["id"], payload["type"], payload.get("data", {})
        if not isinstance(event_id, str) or not isinstance(event_type, str) or not isinstance(data, dict):
            raise TypeError
    except (ValueError, KeyError, TypeError):
        raise InvalidWebhookError()

    # Se guarda lo mínimo para reprocesar: identificadores, duración y reproducción, no el evento entero.
    keep = {k: data.get(k) for k in ("id", "asset_id", "passthrough", "duration", "playback_ids", "tracks")
            if k in data}
    # JSONB no admite NaN ni Infinity (el JSON de Python sí los lee): un valor así se guarda como nulo.
    if isinstance(keep.get("duration"), float) and not math.isfinite(keep["duration"]):
        keep["duration"] = None
    if not repository.record_event(event_id[:80], event_type[:60], str(data.get("id") or "")[:80],
                                   "processed", keep):
        repository.rollback()
        return {"duplicate": True}

    result = apply_event(repository, event_type, data)
    if result != "processed":
        repository.set_event_status(event_id[:80], result)
    repository.commit()
    return {"duplicate": False, "result": result}


def reprocess_deferred(repository, limit=50):
    """Reintenta los eventos que llegaron antes que su video. Devuelve cuántos se resolvieron."""
    resolved = 0
    for event in repository.deferred_events(limit):
        result = apply_event(repository, event["event_type"], event["data"])
        if result != "deferred":
            repository.set_event_status(event["event_id"], result)
            resolved += 1
    repository.commit()
    return resolved


# --- Borrados en Mux con reintentos -------------------------------------------------------------------


def sweep_external_deletions(repository, mux, now, backoff_base=60, batch=20):
    counts = {"done": 0, "failed": 0, "dead": 0}
    if mux is None:
        return counts
    for item in repository.claim_deletions(now, batch):
        if item["provider"] != "mux":
            continue
        try:
            mux.delete_asset(item["external_id"])
        except Exception as error:  # noqa: BLE001 -- cualquier fallo reintenta
            _logger.warning("Borrado externo falló: %s", type(error).__name__)
            counts[repository.mark_deletion_failed(item["id"], now, type(error).__name__, backoff_base)] += 1
        else:
            repository.mark_deletion_done(item["id"], now)
            counts["done"] += 1
    repository.commit()
    return counts
