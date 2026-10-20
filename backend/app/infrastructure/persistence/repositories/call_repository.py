from datetime import datetime, timedelta, timezone

from sqlalchemy import or_

from app.domain.calls import status as call_status
from app.extensions import db
from app.infrastructure.persistence.models import Call


class SQLAlchemyCallRepository:
    def create(self, caller_id, callee_id, kind):
        call = Call(caller_id=caller_id, callee_id=callee_id, kind=kind, status=call_status.RINGING)
        db.session.add(call)
        db.session.commit()
        return call

    def find_by_id(self, call_id):
        return db.session.get(Call, call_id)

    def expire_stale(self, user_ids, ring_seconds):
        """Cierra lo que quedó colgado de estas personas: lo que sonó más de `ring_seconds` pasa a
        `missed` y lo contestado hace más de `MAX_ACTIVE_SECONDS` a `ended`. Es perezoso a propósito: se
        corre al consultar, sin un proceso aparte."""
        now = datetime.now(timezone.utc)
        involved = or_(Call.caller_id.in_(user_ids), Call.callee_id.in_(user_ids))
        changed = (
            Call.query.filter(involved, Call.status == call_status.RINGING)
            .filter(Call.created_at < now - timedelta(seconds=ring_seconds))
            .update({"status": call_status.MISSED, "ended_at": now}, synchronize_session=False)
        )
        changed += (
            Call.query.filter(involved, Call.status == call_status.ACTIVE)
            .filter(Call.answered_at < now - timedelta(seconds=call_status.MAX_ACTIVE_SECONDS))
            .update({"status": call_status.ENDED, "ended_at": now}, synchronize_session=False)
        )
        if changed:
            db.session.commit()

    def open_call_of(self, user_id):
        """La llamada sin terminar (suena o está activa) en la que participa esta persona, o None."""
        return (
            Call.query.filter(
                or_(Call.caller_id == user_id, Call.callee_id == user_id),
                Call.status.in_((call_status.RINGING, call_status.ACTIVE)),
            )
            .order_by(Call.created_at.desc())
            .first()
        )

    def ringing_for(self, callee_id):
        return (
            Call.query.filter_by(callee_id=callee_id, status=call_status.RINGING)
            .order_by(Call.created_at.desc())
            .first()
        )

    def transition(self, call_id, from_statuses, new_status):
        """Cambia el estado solo si sigue en uno de `from_statuses` (un UPDATE condicional, así dos
        peticiones a la vez no pisan el resultado). True si lo cambió."""
        now = datetime.now(timezone.utc)
        values = {"status": new_status}
        values["answered_at" if new_status == call_status.ACTIVE else "ended_at"] = now
        changed = Call.query.filter(Call.id == call_id, Call.status.in_(from_statuses)).update(
            values, synchronize_session=False
        )
        db.session.commit()
        return bool(changed)
