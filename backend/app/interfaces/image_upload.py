# Lectura de peticiones con imágenes adjuntas (ADR-039), compartida por
# POST /api/posts y POST /api/users/<id>/messages.
#
# Cada endpoint acepta DOS formas, para no romper a ningún cliente existente:
#   · JSON (`application/json`): como siempre, sin imágenes.
#   · `multipart/form-data`: los mismos campos como texto, más hasta N archivos en
#     el campo `images`.
#
# El techo HTTP global (Config.MAX_CONTENT_LENGTH, 6 MiB) se mantiene para todo el
# resto de la API; solo las peticiones multipart de estas dos rutas reciben un
# techo mayor, y se fija ANTES de leer el cuerpo, que es cuando Werkzeug lo aplica.

from flask import jsonify, request

from app.domain.media.storage import ImageTooLargeError, InvalidImageError
from app.infrastructure.media.image_processor import MAX_UPLOAD_BYTES, process_attachment

#: 4 imágenes de 5 MiB más el sobrecoste del formato multipart.
MULTIPART_LIMIT_BYTES = 22 * 1024 * 1024

_TRUE = {"true", "1"}
_FALSE = {"false", "0", ""}


def read_request_data():
    """`(data, files)`: el cuerpo como diccionario y la lista de archivos del campo
    `images` (vacía con JSON). `data` es `None` si no llegó nada utilizable."""
    if request.mimetype == "multipart/form-data":
        request.max_content_length = MULTIPART_LIMIT_BYTES
        data = request.form.to_dict()
        # En multipart todo llega como texto: `is_sensitive` se convierte aquí.
        if "is_sensitive" in data:
            lowered = data["is_sensitive"].strip().lower()
            if lowered in _TRUE:
                data["is_sensitive"] = True
            elif lowered in _FALSE:
                data["is_sensitive"] = False
        files = [f for f in request.files.getlist("images") if f and f.filename != ""]
        return data, files

    return request.get_json(silent=True), []


def too_many_images_response(limit):
    plural = "imagen" if limit == 1 else "imágenes"
    return jsonify({"msg": f"Puedes adjuntar como máximo {limit} {plural}"}), 400


def process_files(files, kind):
    """`(prepared, error_response)`. `prepared` es una lista de
    `(bytes, content_type, ancho, alto)`; cada imagen se decodifica por su
    CONTENIDO real (no por extensión ni Content-Type), se le quita el EXIF y se
    reduce. Un archivo inválido anula toda la petición: no se publica a medias."""
    prepared = []
    for upload in files:
        try:
            # +1 para detectar el exceso sin leer un archivo gigante entero.
            raw = upload.read(MAX_UPLOAD_BYTES + 1)
            prepared.append(process_attachment(raw, kind))
        except InvalidImageError:
            return None, (
                jsonify({"msg": "Los archivos deben ser imágenes JPEG, PNG o WebP válidas"}), 400
            )
        except ImageTooLargeError:
            return None, (jsonify({"msg": "Cada imagen puede pesar como máximo 5 MB"}), 413)
    return prepared, None
