# Política de rate limiting (ADR-027-rate-limiting.md). Solo tipos nativos de
# Python -- domain/ no importa Flask ni SQLAlchemy (BACKEND_ARCHITECTURE.md
# §7/§17), mismo criterio que domain/auth/token_policy.py.
#
# Los límites son placeholders de producto explícitos y revisables, igual que
# PASSWORD_RESET_MAX_ATTEMPTS (domain/auth/token_policy.py) o MAX_CONTENT_LENGTH
# -- reglas de negocio, no parámetros de despliegue, así que no se configuran
# por variable de entorno.
#
# ───────────────────────────────────────────────────────────────────────────
# DOS SEMÁNTICAS DISTINTAS, y la diferencia importa:
#
#   `clear_on_success=True`  -> cuenta **fallos**. Un acierto borra el contador.
#       Para endpoints de credenciales (login, 2FA): lo que hay que frenar es
#       adivinar, no usar. Contar los aciertos castigaría a quien entra y sale
#       legítimamente varias veces.
#
#   `clear_on_success=False` -> cuenta **todas** las llamadas.
#       Para endpoints donde la llamada en sí tiene un coste, aunque salga bien:
#       mandar un correo, crear una cuenta. Acá el acierto ES el abuso.
# ───────────────────────────────────────────────────────────────────────────


class RateLimitRule:
    """Un límite concreto: cuántos intentos, en cuánto tiempo, y si un acierto
    borra el contador."""

    __slots__ = ("scope", "limit", "window_seconds", "clear_on_success")

    def __init__(self, scope, limit, window_seconds, clear_on_success):
        self.scope = scope
        self.limit = limit
        self.window_seconds = window_seconds
        self.clear_on_success = clear_on_success


_MINUTE = 60
_HOUR = 60 * 60


#: `POST /api/2fa/verify` — **el motivo por el que existe este ADR**.
#:
#: Un código TOTP son 10^6 combinaciones dentro de una ventana de 30 s. Sin
#: límite, un atacante con el token de desafío (que obtiene con la contraseña ya
#: comprometida) puede recorrer el espacio entero en minutos y el segundo factor
#: no protege nada.
#:
#: 5 intentos por 15 minutos deja la probabilidad de acierto por fuerza bruta en
#: 5/10^6 por ventana (0.0005%) -- mismo orden de magnitud que
#: PASSWORD_RESET_MAX_ATTEMPTS (ADR-010), deliberadamente, porque el problema es
#: el mismo: un código corto que hay que proteger con intentos, no con entropía.
#:
#: Se limita por **cuenta**, no por IP: un atacante rota IPs trivialmente, y lo
#: que se protege es una cuenta concreta. La IP se limita además, aparte.
TWO_FACTOR_VERIFY = RateLimitRule("2fa_verify", 5, 15 * _MINUTE, clear_on_success=True)

#: `POST /api/login`. Más holgado que el 2FA porque una contraseña tiene mucha
#: más entropía que seis dígitos: el límite acá no es contra la fuerza bruta
#: exhaustiva (inviable de todos modos) sino contra el relleno de credenciales
#: y el ataque por diccionario.
LOGIN = RateLimitRule("login", 10, 15 * _MINUTE, clear_on_success=True)

#: Endpoints de 2FA que piden la contraseña estando ya autenticado
#: (`/2fa/confirm`, `/2fa/disable`, `/2fa/recovery-codes`). Se limitan por
#: cuenta: quien ya tiene la sesión no necesita adivinar la contraseña salvo que
#: haya robado el token.
TWO_FACTOR_MANAGE = RateLimitRule("2fa_manage", 10, 15 * _MINUTE, clear_on_success=True)

#: `POST /api/forgot-password` y `POST /api/resend-registration-code`.
#: `clear_on_success=False`: acá **el acierto es el abuso** -- cada llamada
#: exitosa manda un correo, así que lo que se limita es el envío, no el fallo.
#:
#: Complementa (no reemplaza) los cooldowns de 60 s por cuenta que ADR-010/
#: ADR-011 ya imponen: aquellos frenan el reenvío a una misma persona, esto
#: frena a una misma IP bombardeando muchas direcciones distintas.
EMAIL_DISPATCH = RateLimitRule("email_dispatch", 5, 15 * _MINUTE, clear_on_success=False)

#: `POST /api/register`. `clear_on_success=False`: crear cuentas es el abuso.
#: Ventana larga y límite bajo -- nadie legítimo crea cinco cuentas por hora
#: desde la misma IP, y el registro no es una acción que se repita.
REGISTER = RateLimitRule("register", 5, _HOUR, clear_on_success=False)

#: Intentos de verificar un OTP (`/verify-reset-code`,
#: `/verify-registration-code`), limitado **por IP**.
#:
#: Esos endpoints YA tienen un contador de 5 intentos por código
#: (PASSWORD_RESET_MAX_ATTEMPTS / REGISTRATION_MAX_ATTEMPTS, ADR-010/ADR-011) y
#: un cooldown de 60 s para pedir uno nuevo. Esto no lo duplica: cierra el hueco
#: de que ese contador es **por código**, así que pedir códigos nuevos daba 5
#: intentos más cada 60 s indefinidamente. El límite por IP acota eso.
OTP_VERIFY = RateLimitRule("otp_verify", 15, 15 * _MINUTE, clear_on_success=True)

#: `POST /api/reports` (ADR-032 §2), limitado **por persona**.
#:
#: 10 por hora. Reportar es un acto legítimo y a veces repetido (varias
#: publicaciones del mismo acoso), así que el tope no es bajo; lo que se frena es
#: usar el reporte como herramienta de hostigamiento o de saturación de quien
#: modera. `clear_on_success=False`: acá el acierto **es** el uso.
REPORT_CREATE = RateLimitRule("report_create", 10, _HOUR, clear_on_success=False)

#: Publicaciones y mensajes CON imágenes (ADR-039). Cada petición decodifica y
#: re-codifica imágenes (CPU) y escribe en el almacenamiento (coste), así que el
#: acierto es el abuso: `clear_on_success=False`, por cuenta. 40 por hora deja
#: publicar con holgura y frena a quien intente saturar el servidor de imágenes.
IMAGE_UPLOAD = RateLimitRule("image_upload", 40, _HOUR, clear_on_success=False)

#: Mensajes con nota de voz (ADR-042). Decodificar y re-codificar audio cuesta CPU: se cuenta cada
#: envío con audio, por cuenta, y el acierto no limpia el contador (el abuso es el acierto).
AUDIO_UPLOAD = RateLimitRule("audio_upload", 30, _HOUR, clear_on_success=False)

#: Publicaciones y mensajes con video (ADR-046). Re-codificar video es lo más caro que hace el servidor: se
#: cuenta cada envío con video, por cuenta, y el acierto no limpia el contador (el abuso es el acierto).
VIDEO_UPLOAD = RateLimitRule("video_upload", 10, _HOUR, clear_on_success=False)

#: `POST /api/reports` con motivo `child_safety` (ADR-038). Límite PROPIO y más holgado que
#: `REPORT_CREATE`: una persona que ya hizo varios reportes comunes no debe quedarse sin poder
#: denunciar una explotación de menores. Sigue existiendo (no es ilimitado) para que no se use
#: como forma de saturar a quien modera.
REPORT_CHILD_SAFETY = RateLimitRule("report_child_safety", 30, _HOUR, clear_on_success=False)

#: `POST /api/account-deletion/request` (ADR-031). `clear_on_success=False`: cada
#: llamada exitosa manda un correo, así que acá el éxito ES el abuso. Por IP.
ACCOUNT_DELETION_REQUEST = RateLimitRule(
    "account_deletion_request", 5, 15 * _MINUTE, clear_on_success=False
)

#: `POST /api/account-deletion/confirm` (ADR-031). Cuenta **fallos** y se limita por
#: cuenta y por IP: cubre adivinar el código de 6 dígitos y el segundo factor. 5
#: intentos por 15 minutos, el mismo orden que `TWO_FACTOR_VERIFY`, porque es el
#: mismo problema (un código corto que se protege con intentos, no con entropía).
ACCOUNT_DELETION_CONFIRM = RateLimitRule(
    "account_deletion_confirm", 5, 15 * _MINUTE, clear_on_success=True
)

# Lecturas públicas del catálogo de lugares (ADR-040, D7): por IP, sin identidad de
# usuario. Generoso a propósito -- mover el mapa dispara varias consultas -- pero con
# tope, para que un script no pueda recorrer el catálogo sin freno.
PLACES_READ = RateLimitRule("places_read", 120, _MINUTE, clear_on_success=False)
# Guardar/quitar de guardados y reportar datos incorrectos (ADR-040 fase 2): por CUENTA, no
# por IP. Un reporte cuesta tiempo de quien modera, por eso su tope es bajo.
PLACES_SAVE = RateLimitRule("places_save", 60, _MINUTE, clear_on_success=False)
PLACE_REPORT = RateLimitRule("place_report", 10, _HOUR, clear_on_success=False)
# Escribir, editar o borrar una reseña (fase 4a): por cuenta.
PLACE_REVIEW = RateLimitRule("place_review", 20, _HOUR, clear_on_success=False)
# Crear, editar, cancelar o responder planes con amistades y gestionar sus invitaciones
# (fase 5): por cuenta.
PLAN_WRITE = RateLimitRule("plan_write", 30, _HOUR, clear_on_success=False)

#: `POST /api/stories` (ADR-042): 20 historias al día y por cuenta. Cuenta cada intento, no solo
#: los aciertos (decodificar una imagen cuesta CPU), igual que `IMAGE_UPLOAD`.
STORY_CREATE = RateLimitRule("story_create", 20, 24 * _HOUR, clear_on_success=False)

# Reclamos de negocio (ADR-040 fase 6): crear y retirar. Incluye subir un documento.
CLAIM_WRITE = RateLimitRule("claim_write", 5, 24 * _HOUR, clear_on_success=False)

# Panel de negocio (ADR-040 fase 7): editar el lugar y responder reseñas.
BUSINESS_WRITE = RateLimitRule("business_write", 30, _HOUR, clear_on_success=False)

# Reservas (ADR-040 fase 8): solicitar, cancelar, configurar y resolver.
RESERVATION_WRITE = RateLimitRule("reservation_write", 30, _HOUR, clear_on_success=False)

# Cotizador (ADR-040 fase 10): editar el catálogo y pedir cotizaciones.
QUOTE_WRITE = RateLimitRule("quote_write", 30, _HOUR, clear_on_success=False)

# Estadísticas del panel de negocio (ADR-040 §31): lecturas por cuenta.
BUSINESS_ANALYTICS = RateLimitRule("business_analytics", 60, _MINUTE, clear_on_success=False)

# Visitas a la ficha (ADR-040 §33): por IP Y lugar. Una persona real abre, llama y pide ruta pocas
# veces por hora; un script que quiera inflar cifras se topa aquí.
PLACE_VISIT = RateLimitRule("place_visit", 30, _HOUR, clear_on_success=False)

# Rutas hacia un lugar (ADR-040 fase 13): por CUENTA, para que una no gaste el cupo de todas.
ROUTE_REQUEST = RateLimitRule("route_request", 30, _HOUR, clear_on_success=False)
# Recalcular la ruta durante la navegación en vivo (ADR-040 §30): contador APARTE, para que los
# recalculos no gasten el de las rutas normales ni al revés.
ROUTE_REROUTE = RateLimitRule("route_reroute", 30, _HOUR, clear_on_success=False)

DEFAULT_ROUTING_DAILY_BUDGET = 1500


def routing_daily_rule(budget):
    """Cupo diario GLOBAL del proveedor de rutas (identidad «global»). Se arma al usarlo porque
    el tope sale de la configuración (`ROUTING_DAILY_BUDGET`). Un valor ausente o inválido usa
    el predeterminado, por debajo del tope gratuito de OpenRouteService."""
    limit = budget if isinstance(budget, int) and not isinstance(budget, bool) and budget > 0 else DEFAULT_ROUTING_DAILY_BUDGET
    return RateLimitRule("routing_provider", limit, 24 * _HOUR, clear_on_success=False)

# Mensajes a Tero (ADR-041 §8.2): por CUENTA. Cada mensaje cuesta dinero, así que el tope es más
# bajo que el de cualquier endpoint normal; el acierto ES el uso (`clear_on_success=False`).
TERO_CHAT = RateLimitRule("tero_chat", 30, _HOUR, clear_on_success=False)

# Confirmar o cancelar una acción de Tero (ADR-041 §6.2): por CUENTA. No cuesta IA, pero ejecuta
# cambios reales, así que también tiene tope.
TERO_ACTION = RateLimitRule("tero_action", 30, _HOUR, clear_on_success=False)

# Apelar una decisión de moderación (ADR-044 §2.7): por CUENTA. Cada apelación cuesta tiempo de
# revisión; además hay un tope de apelaciones abiertas por persona.
MODERATION_APPEAL = RateLimitRule("moderation_appeal", 10, _HOUR, clear_on_success=False)

# Avisos pedidos por n8n a las rutas internas (ADR-044 §2.8): un tope global, sin identidad de
# persona. Un secreto filtrado no puede convertirse en una avalancha de correos.
INTERNAL_NOTICE = RateLimitRule("internal_notice", 20, _HOUR, clear_on_success=False)

# Comentar en Reels (ADR-055): por cuenta. Cada comentario es una fila nueva, así que se cuenta cada
# intento; 20 por minuto deja conversar y frena el relleno automático.
VIDEO_COMMENT = RateLimitRule("video_comment", 20, _MINUTE, clear_on_success=False)

# Reservar una subida de video (ADR-043-A): 10 por día y cuenta. Cuenta cada intento, también los que
# fallan en Mux (cada reserva puede crear una subida que cuesta).
VIDEO_UPLOAD = RateLimitRule("video_upload", 10, 24 * _HOUR, clear_on_success=False)
