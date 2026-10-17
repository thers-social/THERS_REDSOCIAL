# Adaptadores del puerto PrivateDocumentStorage (ADR-040 fase 6).
#
# Local (desarrollo): los archivos viven en un directorio APARTE de `UPLOAD_DIR` (que se sirve
# público en `/api/media`) y solo se descargan con un token firmado y de vida corta en
# `/api/private-documents/<token>`. S3: un bucket distinto del público y URLs prefirmadas.

from pathlib import Path

from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from app.domain.media.private_storage import PrivateDocumentStorage

_SALT = "thers.private-document.v1"


class LocalPrivateDocumentStorage(PrivateDocumentStorage):
    def __init__(self, root, secret_key, base_url):
        self.root = Path(root).resolve()
        self._signer = URLSafeTimedSerializer(secret_key, salt=_SALT)
        self._base_url = base_url.rstrip("/")

    def _path(self, key):
        path = (self.root / key).resolve()
        if self.root not in path.parents:
            raise ValueError("clave de almacenamiento fuera del directorio raíz")
        return path

    def save(self, key, data, content_type):
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def delete(self, key):
        self._path(key).unlink(missing_ok=True)

    def signed_url(self, key, content_type, ttl_seconds):
        token = self._signer.dumps({"k": key, "t": content_type})
        # `ttl_seconds` se vuelve a aplicar al leer el token (`read_signed`).
        return f"{self._base_url}/{token}"

    def read_signed(self, token, max_age):
        """`(bytes, content_type)` si el token es válido y no venció; si no, None."""
        try:
            payload = self._signer.loads(token, max_age=max_age)
            path = self._path(payload["k"])
            return path.read_bytes(), payload["t"]
        except (BadSignature, SignatureExpired, KeyError, ValueError, OSError):
            return None


class S3PrivateDocumentStorage(PrivateDocumentStorage):
    def __init__(self, bucket, endpoint_url, access_key_id, secret_access_key, region):
        import boto3
        from botocore.config import Config as BotoConfig

        self.bucket = bucket
        self.client = boto3.client(
            "s3",
            endpoint_url=endpoint_url or None,
            aws_access_key_id=access_key_id,
            aws_secret_access_key=secret_access_key,
            region_name=region or "auto",
            config=BotoConfig(signature_version="s3v4", s3={"addressing_style": "path"}),
        )

    def save(self, key, data, content_type):
        self.client.put_object(
            Bucket=self.bucket, Key=key, Body=data, ContentType=content_type,
            CacheControl="private, no-store",
        )

    def delete(self, key):
        self.client.delete_object(Bucket=self.bucket, Key=key)

    def signed_url(self, key, content_type, ttl_seconds):
        return self.client.generate_presigned_url(
            "get_object",
            Params={
                "Bucket": self.bucket,
                "Key": key,
                "ResponseContentType": content_type,
                "ResponseContentDisposition": "attachment",
            },
            ExpiresIn=ttl_seconds,
        )


def build_private_storage(config):
    backend = (config.get("STORAGE_BACKEND") or "local").lower()
    if backend == "s3":
        if not config.get("S3_PRIVATE_BUCKET"):
            # Sin bucket privado la función de reclamos queda deshabilitada (503), nunca se
            # guardan documentos en el bucket público.
            return None
        if not config.get("S3_ACCESS_KEY_ID") or not config.get("S3_SECRET_ACCESS_KEY"):
            return None
        return S3PrivateDocumentStorage(
            bucket=config["S3_PRIVATE_BUCKET"],
            endpoint_url=config.get("S3_ENDPOINT_URL"),
            access_key_id=config["S3_ACCESS_KEY_ID"],
            secret_access_key=config["S3_SECRET_ACCESS_KEY"],
            region=config.get("S3_REGION"),
        )
    if backend != "local":
        raise RuntimeError(f"STORAGE_BACKEND desconocido: {backend!r}")
    return LocalPrivateDocumentStorage(
        config["PRIVATE_UPLOAD_DIR"], config["JWT_SECRET_KEY"], config["PRIVATE_DOCUMENTS_BASE_URL"]
    )
