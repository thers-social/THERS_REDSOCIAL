# Adaptador SQLAlchemy del puerto `PlanRepository` (domain/plans/repositories.py),
# ADR-040 fase 5. Todos los valores van como parámetros ligados; los únicos fragmentos
# dinámicos (columnas de `update_plan`) salen de un diccionario fijo de este módulo.

from sqlalchemy import text

from app.domain.follows.follow_status import ACCEPTED
from app.domain.plans import kinds
from app.domain.plans.repositories import PlanRepository
from app.domain.restrictions.kinds import BLOCK
from app.extensions import db
from app.infrastructure.persistence.repositories.place_cards import fetch_place_cards
from app.infrastructure.persistence.repositories.place_notifications import PlaceNotifierMixin

_EDITABLE = {"title": "title", "note": "note", "starts_at": "starts_at"}

_BLOCKED_BETWEEN = (
    "EXISTS (SELECT 1 FROM user_restrictions r WHERE r.kind = :block AND "
    "((r.owner_id = {a} AND r.target_id = {b}) OR (r.owner_id = {b} AND r.target_id = {a})))"
)


class SQLAlchemyPlanRepository(PlaceNotifierMixin, PlanRepository):
    def public_place_exists(self, place_id):
        return (
            db.session.execute(
                text(
                    "SELECT 1 FROM places p JOIN place_categories c ON c.id = p.category_id "
                    "WHERE p.id = :id AND p.is_active AND p.verification_status = 'verified' "
                    "AND c.is_active"
                ),
                {"id": str(place_id)},
            ).first()
            is not None
        )

    def place_cards(self, place_ids):
        return fetch_place_cards(place_ids)

    def list_friends(self, user_id, limit):
        rows = db.session.execute(
            text(
                "SELECT u.id, u.username, u.name, u.avatar_path FROM users u "
                "WHERE u.id <> :me "
                "AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = :me "
                "  AND f.followed_id = u.id AND f.status = :accepted) "
                "AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = u.id "
                "  AND f.followed_id = :me AND f.status = :accepted) "
                "AND NOT " + _BLOCKED_BETWEEN.format(a=":me", b="u.id") +
                " ORDER BY lower(u.name), u.id LIMIT :limit"
            ),
            {"me": str(user_id), "accepted": ACCEPTED, "block": BLOCK, "limit": limit},
        ).mappings()
        return [dict(row) for row in rows]

    def friends_among(self, user_id, candidate_ids):
        if not candidate_ids:
            return set()
        rows = db.session.execute(
            text(
                "SELECT u.id FROM users u WHERE u.id = ANY(CAST(:ids AS uuid[])) "
                "AND u.id <> :me "
                "AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = :me "
                "  AND f.followed_id = u.id AND f.status = :accepted) "
                "AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = u.id "
                "  AND f.followed_id = :me AND f.status = :accepted) "
                "AND NOT " + _BLOCKED_BETWEEN.format(a=":me", b="u.id")
            ),
            {
                "ids": list(candidate_ids),
                "me": str(user_id),
                "accepted": ACCEPTED,
                "block": BLOCK,
            },
        )
        return {str(row[0]) for row in rows}

    def create_plan(self, creator_id, place_id, title, note, starts_at, invitee_ids):
        plan_id = db.session.execute(
            text(
                "INSERT INTO place_plans (place_id, creator_id, title, note, starts_at) "
                "VALUES (:place, :creator, :title, :note, :starts_at) RETURNING id"
            ),
            {
                "place": str(place_id),
                "creator": str(creator_id),
                "title": title,
                "note": note,
                "starts_at": starts_at,
            },
        ).scalar_one()
        db.session.execute(
            text(
                "INSERT INTO place_plan_members (plan_id, user_id, invited_by, status) "
                "VALUES (:plan, :user, NULL, :going)"
            ),
            {"plan": str(plan_id), "user": str(creator_id), "going": kinds.MEMBER_GOING},
        )
        for invitee in invitee_ids:
            db.session.execute(
                text(
                    "INSERT INTO place_plan_members (plan_id, user_id, invited_by, status) "
                    "VALUES (:plan, :user, :by, :invited)"
                ),
                {
                    "plan": str(plan_id),
                    "user": str(invitee),
                    "by": str(creator_id),
                    "invited": kinds.MEMBER_INVITED,
                },
            )
        db.session.commit()
        return str(plan_id)

    _PLAN_COLUMNS = (
        "pl.id, pl.place_id, pl.title, pl.note, pl.starts_at, pl.status, pl.created_at, "
        "pl.updated_at, pl.creator_id, me.status AS my_status, "
        "cu.username AS creator_username, cu.name AS creator_name, "
        "cu.avatar_path AS creator_avatar_path"
    )
    _PLAN_FROM = (
        "FROM place_plans pl "
        "JOIN place_plan_members me ON me.plan_id = pl.id AND me.user_id = :viewer "
        "JOIN users cu ON cu.id = pl.creator_id"
    )

    def get_plan(self, plan_id, viewer_id):
        row = (
            db.session.execute(
                text(f"SELECT {self._PLAN_COLUMNS} {self._PLAN_FROM} WHERE pl.id = :id"),
                {"id": str(plan_id), "viewer": str(viewer_id)},
            )
            .mappings()
            .first()
        )
        return dict(row) if row else None

    def list_plans(self, viewer_id, scope, limit):
        upcoming = scope == kinds.SCOPE_UPCOMING
        # Los planes ocultos por bloqueo con quien los creó no se listan.
        rows = db.session.execute(
            text(
                f"SELECT {self._PLAN_COLUMNS} {self._PLAN_FROM} "
                f"WHERE pl.starts_at {'>=' if upcoming else '<'} now() "
                f"AND NOT {_BLOCKED_BETWEEN.format(a=':viewer', b='pl.creator_id')} "
                f"ORDER BY pl.starts_at {'ASC' if upcoming else 'DESC'}, pl.id "
                "LIMIT :limit"
            ),
            {"viewer": str(viewer_id), "limit": limit, "block": BLOCK},
        ).mappings()
        return [dict(row) for row in rows]

    def members_of(self, plan_ids, viewer_id):
        ids = [str(i) for i in plan_ids]
        if not ids:
            return {}
        rows = db.session.execute(
            text(
                "SELECT m.plan_id, m.user_id, m.status, u.username, u.name, "
                "u.avatar_path AS avatar_path "
                "FROM place_plan_members m JOIN users u ON u.id = m.user_id "
                "WHERE m.plan_id = ANY(CAST(:ids AS uuid[])) "
                "AND (m.user_id = :viewer OR NOT "
                + _BLOCKED_BETWEEN.format(a=":viewer", b="m.user_id")
                + ") ORDER BY m.created_at, m.id"
            ),
            {"ids": ids, "viewer": str(viewer_id), "block": BLOCK},
        ).mappings()
        grouped = {}
        for row in rows:
            grouped.setdefault(str(row["plan_id"]), []).append(dict(row))
        return grouped

    def update_plan(self, plan_id, creator_id, fields):
        assignments = [f"{_EDITABLE[name]} = :{name}" for name in fields if name in _EDITABLE]
        if not assignments:
            return False
        result = db.session.execute(
            text(
                f"UPDATE place_plans SET {', '.join(assignments)}, updated_at = now() "
                "WHERE id = :id AND creator_id = :creator AND status = :active"
            ),
            {
                **{k: v for k, v in fields.items() if k in _EDITABLE},
                "id": str(plan_id),
                "creator": str(creator_id),
                "active": kinds.PLAN_ACTIVE,
            },
        )
        db.session.commit()
        return result.rowcount > 0

    def cancel_plan(self, plan_id, creator_id):
        result = db.session.execute(
            text(
                "UPDATE place_plans SET status = :cancelled, updated_at = now() "
                "WHERE id = :id AND creator_id = :creator AND status = :active"
            ),
            {
                "id": str(plan_id),
                "creator": str(creator_id),
                "active": kinds.PLAN_ACTIVE,
                "cancelled": kinds.PLAN_CANCELLED,
            },
        )
        db.session.commit()
        return result.rowcount > 0

    def add_invites(self, plan_id, inviter_id, invitee_ids, max_members):
        # Se bloquea la fila del plan: dos invitaciones simultáneas no pueden pasarse del tope.
        db.session.execute(
            text("SELECT id FROM place_plans WHERE id = :id FOR UPDATE"), {"id": str(plan_id)}
        )
        existing = {
            str(row[0])
            for row in db.session.execute(
                text("SELECT user_id FROM place_plan_members WHERE plan_id = :id"),
                {"id": str(plan_id)},
            )
        }
        new_ids = [i for i in invitee_ids if str(i) not in existing]
        if len(existing) + len(new_ids) > max_members:
            db.session.rollback()
            return "full"
        for invitee in new_ids:
            db.session.execute(
                text(
                    "INSERT INTO place_plan_members (plan_id, user_id, invited_by, status) "
                    "VALUES (:plan, :user, :by, :invited)"
                ),
                {
                    "plan": str(plan_id),
                    "user": str(invitee),
                    "by": str(inviter_id),
                    "invited": kinds.MEMBER_INVITED,
                },
            )
        db.session.commit()
        return len(new_ids)

    def respond(self, plan_id, user_id, status):
        result = db.session.execute(
            text(
                "UPDATE place_plan_members m SET status = :status, updated_at = now() "
                "FROM place_plans pl WHERE pl.id = m.plan_id AND m.plan_id = :plan "
                "AND m.user_id = :user AND pl.creator_id <> m.user_id"
            ),
            {"status": status, "plan": str(plan_id), "user": str(user_id)},
        )
        db.session.commit()
        return result.rowcount > 0

    def remove_member(self, plan_id, user_id):
        result = db.session.execute(
            text(
                "DELETE FROM place_plan_members m USING place_plans pl "
                "WHERE pl.id = m.plan_id AND m.plan_id = :plan AND m.user_id = :user "
                "AND pl.creator_id <> m.user_id"
            ),
            {"plan": str(plan_id), "user": str(user_id)},
        )
        db.session.commit()
        return result.rowcount > 0
