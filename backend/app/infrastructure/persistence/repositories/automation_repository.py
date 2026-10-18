# Consultas que alimentan las automatizaciones de n8n (ADR-041 §7). Único punto que traduce entre
# PostgreSQL y los casos de uso de `application/automations/`.
#
# Todo es de SOLO LO NECESARIO: correo de quien recibe y números agregados. Nada de contenido de
# publicaciones, nombres de otras personas ni notas de moderación.

from sqlalchemy import text

from app.extensions import db


class SQLAlchemyAutomationRepository:
    def reporter_for_report(self, report_id):
        """Quién reportó y si se le puede escribir; `None` si el reporte ya no tiene reportante
        (su cuenta se borró: `reports.reporter_id` queda en NULL)."""
        row = (
            db.session.execute(
                text(
                    "SELECT u.email, u.email_verified, (u.suspended_at IS NOT NULL) AS suspended "
                    "FROM reports r JOIN users u ON u.id = r.reporter_id WHERE r.id = :id"
                ),
                {"id": str(report_id)},
            )
            .mappings()
            .first()
        )
        return dict(row) if row else None

    def pending_weekly_summaries(self, period_start, period_end, limit, after=None):
        """Quien activó el resumen, tiene el correo verificado, no está suspendida y todavía no lo
        recibió esta semana (`weekly_summary_sent_at` anterior al fin del periodo), con los números
        de la semana ya terminada. Solo conteos. Quien no tuvo ninguna actividad no se devuelve (un
        resumen en ceros es ruido). `after` (id de usuario) pagina sin que alguien sin acuse bloquee
        la primera fila."""
        rows = (
            db.session.execute(
                text(
                    """
                    SELECT * FROM (SELECT u.id, u.email, u.name,
                      (SELECT count(*) FROM follows f
                        WHERE f.followed_id = u.id AND f.status = 'accepted'
                          AND f.created_at >= :start AND f.created_at < :end) AS new_followers,
                      (SELECT count(*) FROM likes l JOIN posts p ON p.id = l.post_id
                        WHERE p.author_id = u.id AND l.user_id <> u.id
                          AND l.created_at >= :start AND l.created_at < :end) AS likes_received,
                      (SELECT count(*) FROM comments c JOIN posts p ON p.id = c.post_id
                        WHERE p.author_id = u.id AND c.author_id <> u.id
                          AND c.created_at >= :start AND c.created_at < :end) AS comments_received,
                      (SELECT count(*) FROM notifications n
                        WHERE n.recipient_id = u.id AND n.read_at IS NULL) AS unread_notifications
                    FROM users u
                    WHERE u.weekly_summary_email
                      AND u.email_verified
                      AND u.suspended_at IS NULL
                      AND (u.weekly_summary_sent_at IS NULL OR u.weekly_summary_sent_at < :end)
                      AND (CAST(:after AS uuid) IS NULL OR u.id > CAST(:after AS uuid))) s
                    WHERE s.new_followers + s.likes_received + s.comments_received
                          + s.unread_notifications > 0
                    ORDER BY s.id
                    LIMIT :limit
                    """
                ),
                {
                    "start": period_start, "end": period_end, "limit": limit,
                    "after": None if after is None else str(after),
                },
            )
            .mappings()
            .all()
        )
        return [dict(row) for row in rows]

    def mark_weekly_summary_sent(self, user_id, period_end, now):
        """Marca el resumen como entregado. Idempotente: si ya se marcó en este periodo no cambia
        nada. Devuelve `True` solo si esta llamada lo marcó."""
        row = db.session.execute(
            text(
                "UPDATE users SET weekly_summary_sent_at = :now "
                "WHERE id = :id AND weekly_summary_email "
                "AND (weekly_summary_sent_at IS NULL OR weekly_summary_sent_at < :end) "
                "RETURNING 1"
            ),
            {"id": str(user_id), "end": period_end, "now": now},
        ).first()
        db.session.commit()
        return row is not None
