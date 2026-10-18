# Firma de los mensajes entre el backend y n8n (ADR-041 §7). Solo tipos nativos de Python: domain/
# no importa Flask ni SQLAlchemy.
#
# El mismo esquema sirve en los dos sentidos:
#   · backend -> n8n: el backend firma lo que envía y n8n puede comprobar que viene de THERS;
#   · n8n -> backend: n8n firma sus llamadas a la API interna y el backend rechaza lo que no
#     venga firmado. Esa API NO usa JWT: n8n no es una persona y no debe tener una cuenta.
#
# La firma cubre `<marca de tiempo>.<cuerpo exacto>`. La marca de tiempo evita que alguien que
# capture una petición pueda repetirla pasado un rato; la comparación es en tiempo constante.

import hashlib
import hmac

SIGNATURE_HEADER = "X-THERS-Signature"
TIMESTAMP_HEADER = "X-THERS-Timestamp"
IDEMPOTENCY_HEADER = "X-THERS-Idempotency-Key"

#: Cuánto puede diferir la marca de tiempo del reloj del servidor (segundos).
MAX_CLOCK_SKEW_SECONDS = 300

_PREFIX = "sha256="


def sign(secret, timestamp, body):
    """`sha256=<hex>` de `<timestamp>.<body>`. `body` son los bytes EXACTOS que se envían."""
    message = f"{timestamp}.".encode("utf-8") + body
    digest = hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()
    return _PREFIX + digest


def verify(secret, timestamp, signature, body, now, max_skew=MAX_CLOCK_SKEW_SECONDS):
    """`True` solo si la firma es válida Y la marca de tiempo es reciente. Sin secreto, o con
    cualquier dato ausente o mal formado, siempre `False`: nunca lanza."""
    if not secret or not signature or timestamp is None or body is None:
        return False
    try:
        moment = int(str(timestamp))
    except (TypeError, ValueError):
        return False
    if abs(int(now) - moment) > max_skew:
        return False
    expected = sign(secret, moment, body)
    return hmac.compare_digest(expected, str(signature))
