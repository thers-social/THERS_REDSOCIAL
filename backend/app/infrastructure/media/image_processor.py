# Validación y normalización de imágenes subidas (ADR-015). Única pieza que
# importa Pillow. Decodifica el contenido real, aplica la orientación EXIF,
# recorta al aspecto pedido y re-codifica a WebP: el archivo original nunca
# se guarda tal cual, así se descartan EXIF/GPS y cualquier payload
# escondido dentro del archivo.

import io

from PIL import Image, ImageOps, UnidentifiedImageError

from app.domain.media.storage import ImageTooLargeError, InvalidImageError

ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}
MAX_UPLOAD_BYTES = 5 * 1024 * 1024
# Protege contra "decompression bombs" (archivo pequeño, píxeles enormes).
Image.MAX_IMAGE_PIXELS = 40_000_000

# kind -> (ancho, alto) de salida. El recorte es centrado.
TARGET_SIZES = {
    "avatar": (512, 512),
    "cover": (1600, 500),
}


def _decode(raw, transform):
    """Decodifica `raw` por contenido, aplica EXIF y le pasa la imagen RGB a
    `transform`. Cualquier fallo de decodificación es `InvalidImageError`."""
    if len(raw) > MAX_UPLOAD_BYTES:
        raise ImageTooLargeError()

    try:
        with Image.open(io.BytesIO(raw)) as probe:
            if probe.format not in ALLOWED_FORMATS:
                raise InvalidImageError()
            probe.load()
            image = ImageOps.exif_transpose(probe)
            return transform(image.convert("RGB"))
    except InvalidImageError:
        raise
    except (UnidentifiedImageError, OSError, SyntaxError, Image.DecompressionBombError):
        raise InvalidImageError()


def _encode(image):
    out = io.BytesIO()
    image.save(out, format="WEBP", quality=85, method=4)
    return out.getvalue()


def process_image(raw, kind):
    image = _decode(raw, lambda img: ImageOps.fit(img, TARGET_SIZES[kind], Image.LANCZOS))
    return _encode(image), "image/webp"


# Imágenes de publicaciones y mensajes (ADR-039): se conserva la proporción
# (sin recortar) y solo se reduce si el lado mayor pasa de este máximo. Se
# re-codifica a WebP, así se descartan EXIF/GPS y cualquier carga escondida.
ATTACHMENT_MAX_SIDE = {"post": 1600, "message": 1280}


def process_attachment(raw, kind):
    """Devuelve `(bytes_webp, content_type, ancho, alto)`."""
    max_side = ATTACHMENT_MAX_SIDE[kind]

    def _fit(img):
        img.thumbnail((max_side, max_side), Image.LANCZOS)
        return img

    image = _decode(raw, _fit)
    return _encode(image), "image/webp", image.width, image.height
