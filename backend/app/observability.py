# Registro de errores con Sentry (opcional).
#
# Solo se activa si existe `SENTRY_DSN`: sin ella (desarrollo, tests, CI) no se
# importa el SDK ni se envía nada. `send_default_pii=False` evita que Sentry
# adjunte IPs, cookies o cabeceras `Authorization`; los datos de usuarios (email,
# teléfono, fecha de nacimiento) no deben salir hacia un tercero.


def init_observability(app):
    dsn = app.config.get("SENTRY_DSN")
    if not dsn:
        return False

    try:
        import sentry_sdk
        from sentry_sdk.integrations.flask import FlaskIntegration
    except ImportError:
        app.logger.warning("SENTRY_DSN definida pero sentry-sdk no está instalado; se ignora.")
        return False

    sentry_sdk.init(
        dsn=dsn,
        integrations=[FlaskIntegration()],
        environment=app.config.get("SENTRY_ENVIRONMENT"),
        traces_sample_rate=app.config.get("SENTRY_TRACES_SAMPLE_RATE", 0.0),
        send_default_pii=False,
    )
    return True
