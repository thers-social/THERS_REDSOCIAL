# Estados y tipos de una llamada 1 a 1 (llamadas con LiveKit).

AUDIO = "audio"
VIDEO = "video"
KINDS = (AUDIO, VIDEO)

#: Suena en el teléfono o navegador de la persona llamada.
RINGING = "ringing"
#: La contestaron: ambas personas están (o pueden estar) en la sala.
ACTIVE = "active"
DECLINED = "declined"
#: Quien llamó colgó antes de que contestaran.
CANCELLED = "cancelled"
#: Nadie contestó dentro de `CALL_RING_SECONDS`.
MISSED = "missed"
ENDED = "ended"

STATUSES = (RINGING, ACTIVE, DECLINED, CANCELLED, MISSED, ENDED)

#: Una llamada contestada que sigue «activa» más de esto se da por terminada: evita que un cliente
#: que se cerró sin colgar deje a las dos personas «ocupadas» para siempre.
MAX_ACTIVE_SECONDS = 4 * 60 * 60
