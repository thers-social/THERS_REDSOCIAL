# Reglas de producto de los Reels (ADR-043, ADR-043-A). Solo tipos nativos: domain/ no importa Flask
# ni SQLAlchemy (BACKEND_ARCHITECTURE.md §7/§17).

# --- D3 de ADR-043: la subida PÚBLICA de video sigue bloqueada --------------------------------------
#
# Mientras no exista, esté evaluada, implementada, probada y aprobada una solución de seguridad
# infantil (ADR-044 §3), SOLO pueden subir video las cuentas de una lista de prueba. Esta constante
# no es un interruptor de configuración a propósito: abrir la subida al público exige cambiar CÓDIGO
# en un cambio revisado y un ADR aceptado, no editar una variable de entorno.
PUBLIC_UPLOAD_ALLOWED = False

PENDING = "pending"
UPLOADING = "uploading"
PROCESSING = "processing"
READY = "ready"
FAILED = "failed"
BLOCKED = "blocked"

ALL_STATUSES = (PENDING, UPLOADING, PROCESSING, READY, FAILED, BLOCKED)
TERMINAL = (READY, FAILED, BLOCKED)

_ALLOWED = {
    PENDING: (UPLOADING, FAILED),
    UPLOADING: (PROCESSING, FAILED),
    PROCESSING: (READY, FAILED, BLOCKED),
    READY: (BLOCKED,),
    FAILED: (),
    BLOCKED: (),
}

#: 60 s, como pide ADR-043 D2. Mux recodifica; la duración se comprueba al llegar `asset.ready`.
MAX_DURATION_MS = 60_000
MAX_CAPTION = 200
MAX_IDEMPOTENCY_KEY = 80


def can_transition(current, new):
    return new in _ALLOWED.get(current, ())


class VideoNotFoundError(Exception):
    """No existe, no es tuyo o no puedes verlo: el mismo 404 en todos los casos."""


class VideoUploadNotAllowedError(Exception):
    """La cuenta no está en la lista de prueba (D3) o el módulo está apagado."""


class VideoInvalidError(Exception):
    def __init__(self, message):
        super().__init__(message)
        self.message = message


class ProviderUnavailableError(Exception):
    """Mux no está configurado o falló. Sin texto del proveedor."""


def normalize_caption(value):
    if value is None:
        return None
    if not isinstance(value, str):
        raise VideoInvalidError("El texto debe ser una cadena")
    text = value.strip()
    if not text:
        return None
    if len(text) > MAX_CAPTION:
        raise VideoInvalidError(f"El texto puede tener como máximo {MAX_CAPTION} caracteres")
    return text


def normalize_idempotency_key(value):
    if value is None or value == "":
        return None
    if not isinstance(value, str) or not 1 <= len(value) <= MAX_IDEMPOTENCY_KEY \
            or not all(c.isalnum() or c in "-_" for c in value):
        raise VideoInvalidError("La clave de idempotencia no es válida")
    return value


def parse_allowlist(raw):
    """`VIDEO_UPLOAD_ALLOWLIST`: nombres de usuario separados por comas, en minúsculas. Vacía =
    nadie puede subir (falla cerrado)."""
    return frozenset(
        part.strip().lower() for part in (raw or "").split(",") if part.strip()
    )


def may_upload(username, allowlist):
    """Regla D3. `PUBLIC_UPLOAD_ALLOWED` es `False` y no se lee de la configuración."""
    if PUBLIC_UPLOAD_ALLOWED:
        return True  # nunca se ejecuta mientras la constante sea False (la fija una prueba)
    return bool(username) and username.lower() in allowlist


# --- Puertos -------------------------------------------------------------------------------------


class MuxClient:
    """Puerto de la API de Mux. Los adaptadores: HTTP real (`infrastructure/video/mux_client.py`) y
    el simulado de las pruebas. Ningún otro código del backend conoce a Mux."""

    def create_direct_upload(self, video_id, cors_origin):
        """Devuelve `{"upload_id", "url"}`. Lanza `ProviderUnavailableError`."""
        raise NotImplementedError

    def delete_asset(self, asset_id):
        """Borra un asset. Un asset que ya no existe cuenta como borrado. Lanza
        `ProviderUnavailableError` si falla."""
        raise NotImplementedError


class PlaybackSigner:
    """Puerto del token de reproducción firmado, por espectador y de vida corta."""

    def sign(self, playback_id, ttl_seconds):
        raise NotImplementedError

    def hls_url(self, playback_id, token):
        return f"https://stream.mux.com/{playback_id}.m3u8?token={token}"
