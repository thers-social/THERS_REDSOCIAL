# Aviso directo al equipo por correo (ADR-044 decisión 6): un reporte crítico o un contenido retenido
# como crítico se avisan DESDE FLASK por Resend, sin pasar por n8n. Si n8n está caído o apagado, el
# aviso sale igual.
#
# El correo lleva solo la clase de aviso y un enlace al panel: ni el texto reportado, ni la imagen, ni
# nombres. Quien lo lee entra al panel (con su rol y 2FA) para ver el caso.

import logging

from html import escape

from app.application.email.safe_delivery import attempt_delivery

_logger = logging.getLogger(__name__)

SUBJECTS = {
    "report_critical": "Reporte crítico en THERS",
    "content_critical": "Contenido retenido como crítico en THERS",
    "backlog": "Cola de moderación acumulada en THERS",
    "appeal_overdue": "Apelación fuera de plazo en THERS",
    "job_dead": "Trabajo de moderación fallido en THERS",
}


class TeamAlerter:
    """`email_sender` es el puerto `EmailSender`; `recipient` y `panel_url` salen de la
    configuración. Sin destinatario no envía (queda registrado, sin datos)."""

    def __init__(self, email_sender, recipient, panel_url):
        self._sender = email_sender
        self._recipient = (recipient or "").strip() or None
        self._panel_url = (panel_url or "").strip()

    def alert(self, kind):
        """Devuelve `True` si se entregó al proveedor. Nunca lanza: un aviso fallido no puede
        romper el reporte ni la moderación que lo origina."""
        subject = SUBJECTS.get(kind)
        if subject is None:
            return False
        if not self._recipient:
            _logger.warning("Aviso '%s' sin destinatario configurado (MODERATION_ALERT_EMAIL)", kind)
            return False
        link = escape(self._panel_url, quote=True) if self._panel_url else ""
        html = (
            f"<p>{escape(subject)}.</p>"
            "<p>Abre el panel de moderación para revisarlo. Este aviso no incluye el contenido.</p>"
            + (f'<p><a href="{link}">Ir al panel</a></p>' if link else "")
        )
        return attempt_delivery(lambda: self._sender.send(self._recipient, subject, html), kind)
