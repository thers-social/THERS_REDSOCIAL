from flask import Flask, request
from flask_cors import CORS

from .config import Config
from .extensions import jwt, db, migrate


def create_app():

    app = Flask(__name__)
    app.config.from_object(Config)

    # Antes que nada: así Sentry captura también errores del resto del arranque.
    from app.observability import init_observability
    init_observability(app)

    # ADR-018 §Riesgos ítem 5: en un entorno desplegado `CORS_ORIGINS` limita qué sitios web
    # pueden llamar a la API. Sin ella (desarrollo local) queda abierto, como siempre.
    if app.config["ALLOWED_WEB_ORIGINS"]:
        CORS(app, origins=app.config["ALLOWED_WEB_ORIGINS"])
    else:
        CORS(app)

    jwt.init_app(app)
    db.init_app(app)
    migrate.init_app(app, db)

    # Almacenamiento de imágenes de perfil (ADR-015-profile-media.md).
    from app.application.media.media_url import configure_media_url
    from app.infrastructure.media.factory import build_media_storage

    app.extensions["media_storage"] = build_media_storage(app.config)
    configure_media_url(app.config["MEDIA_PUBLIC_BASE_URL"])
    from app.application.media.image_visibility import configure_moderation
    configure_moderation(app.config.get("MODERATION_ENABLED"))

    # Documentos privados de reclamos (ADR-040 fase 6): almacenamiento aparte, nunca público.
    from app.infrastructure.media.private_storage import build_private_storage

    app.extensions["private_storage"] = build_private_storage(app.config)

    # Versión vigente de los términos de uso (ADR-032 §5).
    from app.application.terms.terms_version import configure_terms_version

    configure_terms_version(app.config["TERMS_VERSION"])

    @app.after_request
    def _no_store_for_authenticated_requests(response):
        # Hallazgo de la validación en dispositivo (2026-10-02): la capa de red
        # de React Native (OkHttp) guardaba en su caché de disco la respuesta de
        # GET /api/users/me -- el JSON del usuario -- aunque `session.ts`
        # decide no persistirlo. Una respuesta a una petición autenticada nunca
        # debe cachearse en el cliente. Los recursos públicos (p. ej. imágenes
        # de /api/media, que se piden sin Authorization) conservan su caché.
        if request.headers.get("Authorization") and "Cache-Control" not in response.headers:
            response.headers["Cache-Control"] = "no-store"
        return response

    from app.interfaces.security_headers import register_security_headers
    register_security_headers(app)

    from app.interfaces.error_handlers import register_error_handlers
    register_error_handlers(app)

    # Marca `users.last_seen_at` en cada petición autenticada que resuelve
    # bien, con throttle (ADR-024-content-filters-and-privacy-preferences.md).
    # Se registra acá y no en cada route para que ningún endpoint nuevo se
    # olvide de hacerlo.
    from app.interfaces.activity_tracker import register_activity_tracker
    register_activity_tracker(app)

    # Registra los modelos en el metadata de SQLAlchemy para que Flask-Migrate
    # los detecte al autogenerar migraciones (flask db migrate).
    from app.infrastructure.persistence import models  # noqa: F401

    from app.interfaces.routes.health_routes import health_bp
    app.register_blueprint(health_bp, url_prefix="/api")

    from app.interfaces.routes.auth_routes import auth_bp
    app.register_blueprint(auth_bp, url_prefix="/api")

    from app.interfaces.routes.user_routes import users_bp
    app.register_blueprint(users_bp, url_prefix="/api")

    from app.interfaces.routes.post_routes import posts_bp
    app.register_blueprint(posts_bp, url_prefix="/api")

    from app.interfaces.routes.story_routes import stories_bp
    app.register_blueprint(stories_bp, url_prefix="/api")

    from app.interfaces.routes.like_routes import likes_bp
    app.register_blueprint(likes_bp, url_prefix="/api")

    from app.interfaces.routes.comment_routes import comments_bp
    app.register_blueprint(comments_bp, url_prefix="/api")

    from app.interfaces.routes.follow_routes import follows_bp
    app.register_blueprint(follows_bp, url_prefix="/api")

    from app.interfaces.routes.notification_routes import notifications_bp
    app.register_blueprint(notifications_bp, url_prefix="/api")

    from app.interfaces.routes.message_routes import messages_bp
    app.register_blueprint(messages_bp, url_prefix="/api")

    from app.interfaces.routes.privacy_routes import privacy_bp
    app.register_blueprint(privacy_bp, url_prefix="/api")

    from app.interfaces.routes.security_routes import security_bp
    app.register_blueprint(security_bp, url_prefix="/api")

    from app.interfaces.routes.data_export_routes import data_exports_bp
    app.register_blueprint(data_exports_bp, url_prefix="/api")

    from app.interfaces.routes.restriction_routes import restrictions_bp
    app.register_blueprint(restrictions_bp, url_prefix="/api")

    # Reportes y aceptación de términos (ADR-032, fase 1).
    from app.interfaces.routes.report_routes import reports_bp
    app.register_blueprint(reports_bp, url_prefix="/api")

    from app.interfaces.routes.terms_routes import terms_bp
    app.register_blueprint(terms_bp, url_prefix="/api")

    from app.interfaces.routes.content_routes import content_bp
    app.register_blueprint(content_bp, url_prefix="/api")

    # Moderación de la plataforma (ADR-032 fase 2): solo cuentas con `is_moderator`.
    from app.interfaces.routes.moderation_routes import moderation_bp
    app.register_blueprint(moderation_bp, url_prefix="/api")

    # Panel de moderación de contenido y apelaciones (ADR-044): apagado con MODERATION_ENABLED.
    from app.interfaces.routes.content_moderation_routes import content_moderation_bp
    app.register_blueprint(content_moderation_bp, url_prefix="/api")

    # THERS Places (ADR-040): catálogo público de lugares, solo lectura en la fase 1.
    from app.interfaces.routes.place_routes import places_bp
    app.register_blueprint(places_bp, url_prefix="/api")

    # Moderación de lugares (ADR-040 fase 2, D3): solo cuentas con `is_moderator`.
    from app.interfaces.routes.place_moderation_routes import place_moderation_bp
    app.register_blueprint(place_moderation_bp, url_prefix="/api")

    # Planes con amistades (ADR-040 fase 5): solo con sesión.
    from app.interfaces.routes.plan_routes import plans_bp
    app.register_blueprint(plans_bp, url_prefix="/api")

    # Tero, asistente con IA (ADR-041, fase 4): chat. Apagado por defecto (TERO_ENABLED).
    from app.interfaces.routes.tero_routes import tero_bp
    app.register_blueprint(tero_bp, url_prefix="/api")

    # Moderación de contenido (ADR-044): clasificador de imágenes. Solo existe el simulado y solo si
    # se pide explícitamente; sin él, el worker deja todo retenido (falla cerrado).
    from app.infrastructure.content_moderation.factory import image_classifier
    from app.infrastructure.content_moderation.factory import text_classifier
    app.extensions["thers_content_moderation"] = {
        "image_classifier": image_classifier(app),
        "text_classifier": text_classifier(app),
    }

    # Avisos y automatización (ADR-044 §2.8): aviso directo por correo y rutas internas para n8n.
    from app.application.automation.alerts import TeamAlerter
    from app.infrastructure.email.factory import create_email_sender

    app.extensions["team_alerter"] = TeamAlerter(
        create_email_sender(
            app.config.get("RESEND_API_KEY"), app.config.get("EMAIL_FROM"),
            app.config.get("EMAIL_REPLY_TO"),
        ),
        app.config.get("MODERATION_ALERT_EMAIL"),
        app.config.get("MODERATION_PANEL_URL"),
    )
    from app.interfaces.routes.internal_routes import internal_bp
    app.register_blueprint(internal_bp, url_prefix="/api")

    # Comandos de línea de comandos (flask set-moderator, flask unsuspend-user).
    from app.interfaces.cli import register_cli
    register_cli(app)

    # Eliminación de cuenta (ADR-031-account-deletion.md).
    from app.interfaces.routes.account_deletion_routes import account_deletion_bp
    app.register_blueprint(account_deletion_bp, url_prefix="/api")
    # Servir imágenes desde disco solo con STORAGE_BACKEND=local (en s3 las
    # sirve el proveedor directamente desde su URL pública).
    if (app.config.get("STORAGE_BACKEND") or "local").lower() == "local":
        from app.interfaces.routes.media_routes import media_bp
        app.register_blueprint(media_bp, url_prefix="/api")
        from app.interfaces.routes.private_document_routes import private_documents_bp
        app.register_blueprint(private_documents_bp, url_prefix="/api")

    from app.interfaces.routes.claim_routes import claims_bp
    app.register_blueprint(claims_bp, url_prefix="/api")

    from app.interfaces.routes.business_routes import business_bp
    app.register_blueprint(business_bp, url_prefix="/api")

    from app.interfaces.routes.reservation_routes import reservations_bp
    app.register_blueprint(reservations_bp, url_prefix="/api")

    from app.interfaces.routes.quote_routes import quotes_bp
    app.register_blueprint(quotes_bp, url_prefix="/api")

    from app.interfaces.routes.routing_routes import routing_bp
    app.register_blueprint(routing_bp, url_prefix="/api")

    return app