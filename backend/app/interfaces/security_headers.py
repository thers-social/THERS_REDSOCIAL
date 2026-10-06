# Cabeceras de seguridad de la API (Sprint 1 de endurecimiento).
#
# La API solo devuelve JSON y archivos de /api/media: no sirve HTML, así que la
# política es restrictiva a propósito. Se usa `setdefault` para no pisar lo que
# una ruta ya haya decidido (p. ej. `Cache-Control` de /api/media).
#
# HSTS solo se envía si la petición llegó por HTTPS (directo o detrás del proxy
# de Render/Cloudflare, que informa con `X-Forwarded-Proto`). En desarrollo
# local (http) no se envía: el navegador recordaría "solo HTTPS" para localhost.
#
# NO se envía `Cross-Origin-Resource-Policy: same-origin`: las imágenes de
# /api/media las carga la web desde otro origen (staging.<dominio> -> api.<dominio>).

_BASE_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    # Una respuesta de la API nunca debe poder ejecutar scripts ni ser embebida.
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
}

_HSTS = "max-age=31536000; includeSubDomains"


def _is_https(request):
    forwarded = request.headers.get("X-Forwarded-Proto", "")
    return request.is_secure or forwarded.split(",")[0].strip().lower() == "https"


def register_security_headers(app):
    from flask import request

    @app.after_request
    def _apply_security_headers(response):
        for name, value in _BASE_HEADERS.items():
            response.headers.setdefault(name, value)
        if _is_https(request):
            response.headers.setdefault("Strict-Transport-Security", _HSTS)
        return response
