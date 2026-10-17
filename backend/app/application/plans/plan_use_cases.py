# Casos de uso de los planes con amistades (ADR-040 fase 5). La validación vive en
# `domain/plans/validators.py`; aquí solo se orquesta.
#
# Reglas de acceso: un plan lo ve únicamente quien es integrante (el resto recibe 404, igual
# que si no existiera); editar, cancelar e invitar es solo de quien lo creó; solo se invita a
# amistades (seguimiento mutuo aceptado y sin bloqueo); un plan cancelado o ya pasado no
# admite cambios.

from datetime import datetime, timezone

from app.application.plans import plan_presenter
from app.domain.notifications import place_events
from app.domain.places.exceptions import PlaceNotFoundError
from app.domain.plans import kinds, validators
from app.domain.plans.exceptions import (
    NotFriendsError,
    PlanClosedError,
    PlanForbiddenError,
    PlanFullError,
    PlanNotFoundError,
)


def _present_many(rows, viewer_id, repository):
    members = repository.members_of([row["id"] for row in rows], viewer_id)
    cards = repository.place_cards([row["place_id"] for row in rows])
    return [
        plan_presenter.present_plan(row, members.get(str(row["id"]), []), cards) for row in rows
    ]


def _load(plan_id, viewer_id, repository):
    row = repository.get_plan(plan_id, viewer_id)
    if row is None:
        raise PlanNotFoundError()
    return row


def _is_open(row):
    return row["status"] == kinds.PLAN_ACTIVE and row["starts_at"] > datetime.now(timezone.utc)


def _require_creator(row, user_id):
    if str(row["creator_id"]) != str(user_id):
        raise PlanForbiddenError()


def _require_open(row):
    if not _is_open(row):
        raise PlanClosedError()


def _require_friends(user_id, ids, repository):
    if ids and repository.friends_among(user_id, ids) != set(ids):
        raise NotFriendsError()


def list_friends(user_id, repository):
    return [
        plan_presenter.present_friend(row)
        for row in repository.list_friends(user_id, kinds.MAX_FRIENDS_LISTED)
    ]


def get_plan(plan_id, user_id, repository):
    return _present_many([_load(plan_id, user_id, repository)], user_id, repository)[0]


def create_plan(user_id, place_id, data, repository):
    title = validators.parse_title(data.get("title"))
    note = validators.parse_note(data.get("note"))
    starts_at = validators.parse_starts_at(data.get("starts_at"))
    invitee_ids = validators.parse_user_ids(data.get("user_ids"))
    if not repository.public_place_exists(place_id):
        raise PlaceNotFoundError()
    _require_friends(user_id, invitee_ids, repository)
    plan_id = repository.create_plan(user_id, place_id, title, note, starts_at, invitee_ids)
    repository.notify_people(place_events.PLAN_INVITE, place_id, plan_id, invitee_ids, user_id)
    return get_plan(plan_id, user_id, repository)


def list_plans(user_id, scope_raw, repository):
    scope = validators.parse_scope(scope_raw)
    return _present_many(repository.list_plans(user_id, scope, kinds.MAX_LIST), user_id, repository)


def update_plan(plan_id, user_id, data, repository):
    row = _load(plan_id, user_id, repository)
    _require_creator(row, user_id)
    _require_open(row)
    fields = {}
    if "title" in data:
        fields["title"] = validators.parse_title(data["title"])
    if "note" in data:
        fields["note"] = validators.parse_note(data["note"])
    if "starts_at" in data:
        fields["starts_at"] = validators.parse_starts_at(data["starts_at"])
    if fields and not repository.update_plan(plan_id, user_id, fields):
        raise PlanClosedError()
    return get_plan(plan_id, user_id, repository)


def cancel_plan(plan_id, user_id, repository):
    row = _load(plan_id, user_id, repository)
    _require_creator(row, user_id)
    if not repository.cancel_plan(plan_id, user_id):
        raise PlanClosedError()
    return get_plan(plan_id, user_id, repository)


def invite(plan_id, user_id, data, repository):
    row = _load(plan_id, user_id, repository)
    _require_creator(row, user_id)
    _require_open(row)
    ids = validators.parse_user_ids(data.get("user_ids"), required=True)
    _require_friends(user_id, ids, repository)
    if repository.add_invites(plan_id, user_id, ids, kinds.MAX_MEMBERS) == "full":
        raise PlanFullError()
    # Quien ya era integrante no recibe otro aviso: el índice único lo evita.
    repository.notify_people(place_events.PLAN_INVITE, row["place_id"], plan_id, ids, user_id)
    return get_plan(plan_id, user_id, repository)


def respond(plan_id, user_id, data, repository):
    status = validators.parse_response(data.get("status"))
    row = _load(plan_id, user_id, repository)
    if str(row["creator_id"]) == str(user_id):
        # Quien crea el plan siempre va; para no ir, lo cancela.
        raise PlanForbiddenError()
    _require_open(row)
    repository.respond(plan_id, user_id, status)
    return get_plan(plan_id, user_id, repository)


def remove_member(plan_id, user_id, member_id, repository):
    """Quien crea el plan saca a otra persona; cualquiera puede salirse. Quien crea no sale:
    cancela."""
    row = _load(plan_id, user_id, repository)
    leaving = str(member_id) == str(user_id)
    if not leaving:
        _require_creator(row, user_id)
    if str(member_id) == str(row["creator_id"]):
        raise PlanForbiddenError()
    if not repository.remove_member(plan_id, member_id):
        raise PlanNotFoundError()
    return {"removed": True}
