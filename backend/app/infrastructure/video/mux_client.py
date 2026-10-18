# Adaptadores de Mux (ADR-043-A). SIN SDK: HTTPS con `requests`, como pide el ADR, para no añadir una
# dependencia ni un proveedor de acceso al resto del backend.
#
# Aviso de honestidad: las formas de petición de `MuxHttpClient` se escribieron a partir de la
# documentación de Mux y las pruebas las verifican contra un `requests` simulado. NO se han probado
# contra Mux de verdad (no hay cuenta ni credenciales). Antes de encender `VIDEOS_ENABLED` en
# cualquier entorno hay que correr una subida real de prueba.

import base64
import time
import uuid

import jwt

from app.domain.videos.rules import MuxClient, PlaybackSigner, ProviderUnavailableError

_API = "https://api.mux.com"


class MuxHttpClient(MuxClient):
    def __init__(self, token_id, token_secret, timeout_seconds=10.0, api_base=_API):
        self._auth = (token_id, token_secret)
        self._timeout = timeout_seconds
        self._base = api_base.rstrip("/")

    def _request(self, method, path, json=None):
        import requests

        try:
            return requests.request(
                method, f"{self._base}{path}", json=json, auth=self._auth,
                timeout=self._timeout, allow_redirects=False,
            )
        except requests.RequestException as error:
            # Solo la clase: ni URL, ni cuerpo, ni credenciales.
            raise ProviderUnavailableError(type(error).__name__) from None

    def create_direct_upload(self, video_id, cors_origin):
        response = self._request("POST", "/video/v1/uploads", json={
            "cors_origin": cors_origin or "*",
            "new_asset_settings": {
                # Reproducción FIRMADA: nadie reproduce con solo conocer el identificador.
                "playback_policy": ["signed"],
                # Nuestro identificador viaja en el asset para casar los webhooks.
                "passthrough": str(video_id),
                "video_quality": "basic",
                "max_resolution_tier": "1080p",
            },
        })
        if response.status_code not in (200, 201):
            raise ProviderUnavailableError(f"http_{response.status_code}")
        try:
            data = response.json()["data"]
            return {"upload_id": data["id"], "url": data["url"]}
        except (ValueError, KeyError, TypeError):
            raise ProviderUnavailableError("bad_response") from None

    def delete_asset(self, asset_id):
        response = self._request("DELETE", f"/video/v1/assets/{asset_id}")
        # 404: ya no existe = borrado.
        if response.status_code not in (200, 204, 404):
            raise ProviderUnavailableError(f"http_{response.status_code}")


class FakeMuxClient(MuxClient):
    """Mux simulado: sin red ni credenciales. Registra lo que se le pidió."""

    def __init__(self, fail_with=None):
        self.uploads, self.deleted = [], []
        self.fail_with = fail_with

    def create_direct_upload(self, video_id, cors_origin):
        if self.fail_with:
            raise self.fail_with
        upload_id = f"fake-upload-{uuid.uuid4().hex[:12]}"
        self.uploads.append({"video_id": str(video_id), "upload_id": upload_id, "cors": cors_origin})
        return {"upload_id": upload_id, "url": f"https://fake-upload.invalid/{upload_id}"}

    def delete_asset(self, asset_id):
        if self.fail_with:
            raise self.fail_with
        self.deleted.append(asset_id)


class MuxPlaybackSigner(PlaybackSigner):
    """Token RS256 de reproducción firmada de Mux: `sub` = playback id, `aud` = `v` (video),
    `kid` = clave de firma. La clave privada llega en base64 (formato de Mux) y vive solo en el
    servidor."""

    def __init__(self, key_id, private_key_b64):
        self._key_id = key_id
        self._private_key = base64.b64decode(private_key_b64)

    def sign(self, playback_id, ttl_seconds):
        return jwt.encode(
            {"sub": playback_id, "aud": "v", "exp": int(time.time()) + int(ttl_seconds),
             "kid": self._key_id},
            self._private_key, algorithm="RS256", headers={"kid": self._key_id},
        )


class FakePlaybackSigner(PlaybackSigner):
    """Firmador simulado (HS256 con un secreto fijo de pruebas): permite verificar claims y caducidad."""

    SECRET = "fake-playback-secret-for-tests-only-0123456789"

    def sign(self, playback_id, ttl_seconds):
        return jwt.encode(
            {"sub": playback_id, "aud": "v", "exp": int(time.time()) + int(ttl_seconds)},
            self.SECRET, algorithm="HS256",
        )


def build_mux_client(config):
    """HTTP real si hay credenciales; simulado solo con `MUX_CLIENT=fake` (desarrollo y pruebas);
    si no, `None`: subir un video responde 503 (nunca se inventa un proveedor)."""
    if config.get("MUX_TOKEN_ID") and config.get("MUX_TOKEN_SECRET"):
        return MuxHttpClient(config["MUX_TOKEN_ID"], config["MUX_TOKEN_SECRET"],
                             config.get("MUX_TIMEOUT_SECONDS", 10.0))
    if config.get("MUX_CLIENT") == "fake":
        return FakeMuxClient()
    return None


def build_playback_signer(config):
    if config.get("MUX_SIGNING_KEY_ID") and config.get("MUX_SIGNING_PRIVATE_KEY"):
        return MuxPlaybackSigner(config["MUX_SIGNING_KEY_ID"], config["MUX_SIGNING_PRIVATE_KEY"])
    if config.get("MUX_CLIENT") == "fake":
        return FakePlaybackSigner()
    return None
