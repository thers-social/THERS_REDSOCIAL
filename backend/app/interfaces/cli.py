# Comandos de línea de comandos de la moderación (ADR-032 §3).
#
# `is_moderator` se asigna SOLO por aquí, nunca por la API: así una cuenta
# comprometida no puede ascenderse a sí misma. Se ejecutan en el servidor, con
# acceso a la base de datos:
#
#   flask set-moderator persona@correo.com            # concede el rol
#   flask set-moderator persona@correo.com --revoke   # lo retira
#   flask unsuspend-user persona@correo.com           # levanta una suspensión

import click

from app.infrastructure.persistence.repositories.moderation_repository import (
    SQLAlchemyModerationRepository,
)
from app.infrastructure.persistence.repositories.user_repository import (
    SQLAlchemyUserRepository,
)


def register_cli(app):
    moderation_repository = SQLAlchemyModerationRepository()
    user_repository = SQLAlchemyUserRepository()

    def _find(email):
        user = user_repository.find_by_email(email.strip())
        if user is None:
            raise click.ClickException("No existe una cuenta con ese correo")
        return user

    @app.cli.command("set-moderator")
    @click.argument("email")
    @click.option("--revoke", is_flag=True, help="Retira el rol en vez de concederlo.")
    def set_moderator(email, revoke):
        """Concede o retira el rol de moderación a una cuenta."""
        user = _find(email)
        moderation_repository.set_moderator(user.id, not revoke)
        if revoke:
            click.echo("Rol de moderación retirado.")
            return
        click.echo("Rol de moderación concedido.")
        if not user.two_factor_enabled:
            # ADR-032 §Riesgos: una cuenta moderadora comprometida puede retirar
            # contenido y suspender cuentas. Exigir la 2FA sigue siendo decisión del equipo.
            click.echo(
                "AVISO: esta cuenta no tiene la verificación en dos pasos (2FA) activada. "
                "Se recomienda activarla antes de moderar."
            )

    @app.cli.command("set-moderation-role")
    @click.argument("email")
    @click.argument("role", type=click.Choice(["reviewer", "child_safety", "admin", "none"]))
    def set_moderation_role(email, role):
        """Asigna el rol de moderación de contenido (ADR-044): reviewer, child_safety, admin o none."""
        from app.extensions import db
        from app.infrastructure.persistence.models import User

        user = _find(email)
        row = db.session.get(User, user.id)
        row.moderation_role = None if role == "none" else role
        # El panel de reportes (ADR-032) sigue exigiendo `is_moderator`: se mantiene alineado.
        row.is_moderator = role != "none"
        db.session.commit()
        click.echo("Rol de moderación retirado." if role == "none" else f"Rol asignado: {role}.")
        if role != "none" and not user.two_factor_enabled:
            click.echo(
                "AVISO: esta cuenta no tiene la verificación en dos pasos (2FA) activada; "
                "con MODERATION_REQUIRE_2FA encendido no podrá moderar."
            )

    @app.cli.command("moderation-worker")
    @click.option("--once", is_flag=True, help="Procesa los trabajos listos y termina.")
    @click.option("--interval", default=5.0, show_default=True, help="Segundos entre ciclos.")
    def moderation_worker(once, interval):
        """Procesa la cola de moderación de contenido (ADR-044). Requiere MODERATION_ENABLED."""
        import time
        import uuid
        from datetime import datetime, timezone

        from app.application.content_moderation.process_jobs import process_next
        from app.application.content_moderation.settings import settings_from_config
        from app.infrastructure.persistence.repositories.content_moderation_repository import (
            SQLAlchemyContentModerationRepository,
        )

        settings = settings_from_config(app.config)
        if not settings.enabled:
            raise click.ClickException("MODERATION_ENABLED está apagado; no hay nada que procesar.")
        from app.infrastructure.persistence.repositories.domain_event_repository import (
            SQLAlchemyDomainEventRepository,
        )

        classifier = app.extensions["thers_content_moderation"]["image_classifier"]
        repository = SQLAlchemyContentModerationRepository()
        events = SQLAlchemyDomainEventRepository()
        alerter = app.extensions.get("team_alerter")
        worker_id = f"worker-{uuid.uuid4().hex[:8]}"
        while True:
            processed = 0
            while process_next(
                repository, classifier, settings, worker_id, datetime.now(timezone.utc),
                events=events, alerter=alerter,
            ) is not None:
                processed += 1
            if once:
                click.echo(f"Trabajos procesados: {processed}")
                return
            time.sleep(interval)

    @app.cli.command("videos-sweep")
    def videos_sweep():
        """Borra en Mux los assets pendientes y reprocesa webhooks que llegaron antes que su video."""
        from datetime import datetime, timezone

        from app.application.videos import video_use_cases
        from app.infrastructure.persistence.repositories.video_repository import (
            SQLAlchemyVideoRepository,
        )

        repository = SQLAlchemyVideoRepository()
        counts = video_use_cases.sweep_external_deletions(
            repository, app.extensions.get("mux_client"), datetime.now(timezone.utc)
        )
        resolved = video_use_cases.reprocess_deferred(repository)
        click.echo(f"Borrados en Mux: {counts}. Eventos pendientes resueltos: {resolved}.")

    @app.cli.command("n8n-dispatch")
    @click.option("--once", is_flag=True, help="Despacha un lote y termina.")
    @click.option("--interval", default=10.0, show_default=True, help="Segundos entre lotes.")
    def n8n_dispatch(once, interval):
        """Envía a n8n los eventos pendientes (ADR-044 §2.8). Sin N8N_* configurado no envía nada."""
        import time
        from datetime import datetime, timezone

        from app.application.automation.dispatch import dispatch_batch
        from app.infrastructure.automation.transports import build_transport
        from app.infrastructure.persistence.repositories.domain_event_repository import (
            SQLAlchemyDomainEventRepository,
        )

        transport = build_transport(app.config)
        if transport is None:
            raise click.ClickException(
                "n8n no está configurado (N8N_ENABLED, N8N_WEBHOOK_URL y N8N_OUTBOUND_SECRET); "
                "los eventos esperan en la base."
            )
        repository = SQLAlchemyDomainEventRepository()
        while True:
            counts = dispatch_batch(
                repository, transport, app.config["N8N_OUTBOUND_SECRET"], datetime.now(timezone.utc)
            )
            if once:
                click.echo(f"Enviados: {counts['sent']}, fallidos: {counts['failed']}, muertos: {counts['dead']}")
                return
            time.sleep(interval)

    @app.cli.command("unsuspend-user")
    @click.argument("email")
    def unsuspend_user(email):
        """Levanta la suspensión de una cuenta."""
        user = _find(email)
        if moderation_repository.unsuspend_user(user.id):
            click.echo("Suspensión levantada.")
        else:
            click.echo("La cuenta no estaba suspendida.")
