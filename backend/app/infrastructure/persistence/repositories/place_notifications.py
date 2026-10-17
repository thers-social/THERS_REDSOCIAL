# Avisos de THERS Places (ADR-040 fase 12). Mixin para los repositorios de reservas, cotizaciones,
# planes, reclamos y reseñas: cada caso de uso, YA hecha su acción, llama a `notify_place_event`.
#
# Reglas (todas en la misma sentencia SQL, no en Python):
#  - un solo aviso por destinatario, tipo, objeto y estado (índice único; reintentos no duplican);
#  - nunca se avisa a quien hizo la acción;
#  - con un bloqueo entre las dos partes, en cualquier dirección, no se crea el aviso;
#  - el aviso no lleva texto libre: solo tipo, lugar, objeto y estado.
# Es de mejor esfuerzo: si falla, la acción ya hecha NO se deshace (se registra y se sigue).

import logging

from sqlalchemy import text

from app.extensions import db

logger = logging.getLogger(__name__)

_INSERT = """
INSERT INTO notifications (recipient_id, actor_id, type, place_id, object_id, detail)
SELECT r.id, CAST(:actor AS uuid), :type, :place, :object, :detail
FROM ({recipients}) AS r(id)
WHERE (CAST(:actor AS uuid) IS NULL OR r.id <> CAST(:actor AS uuid))
  AND (
    CAST(:actor AS uuid) IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM user_restrictions ur
      WHERE ur.kind = 'block'
        AND ((ur.owner_id = r.id AND ur.target_id = CAST(:actor AS uuid))
          OR (ur.owner_id = CAST(:actor AS uuid) AND ur.target_id = r.id))
    )
  )
ON CONFLICT DO NOTHING
"""

_MANAGERS = "SELECT user_id FROM place_managers WHERE place_id = CAST(:place AS uuid)"
_PEOPLE = "SELECT unnest(CAST(:people AS uuid[]))"


class PlaceNotifierMixin:
    def _notify(self, recipients_sql, params, notification_type, place_id, object_id, actor_id, detail):
        try:
            db.session.execute(
                text(_INSERT.format(recipients=recipients_sql)),
                {
                    "actor": str(actor_id) if actor_id else None,
                    "type": notification_type,
                    "place": str(place_id),
                    "object": str(object_id),
                    "detail": detail,
                    **params,
                },
            )
            db.session.commit()
        except Exception:  # noqa: BLE001 - el aviso nunca debe romper la acción ya hecha
            db.session.rollback()
            logger.exception("No se pudo crear el aviso %s", notification_type)

    def notify_managers(self, notification_type, place_id, object_id, actor_id, detail=None):
        """Avisa a TODAS las personas que gestionan el lugar."""
        self._notify(_MANAGERS, {}, notification_type, place_id, object_id, actor_id, detail)

    def notify_people(self, notification_type, place_id, object_id, people_ids, actor_id, detail=None):
        """Avisa a personas concretas (quien reservó, quien cotizó, las invitadas...)."""
        people = [str(person) for person in people_ids if person]
        if not people:
            return
        self._notify(_PEOPLE, {"people": people}, notification_type, place_id, object_id, actor_id, detail)

    def review_author(self, review_id):
        row = db.session.execute(
            text("SELECT user_id FROM place_reviews WHERE id = :r"), {"r": str(review_id)}
        ).first()
        return row[0] if row else None
