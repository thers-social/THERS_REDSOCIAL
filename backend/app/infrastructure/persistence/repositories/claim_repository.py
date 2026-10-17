# Adaptador SQLAlchemy del puerto `ClaimRepository` (domain/claims/repositories.py), ADR-040
# fase 6. Todos los valores van como parámetros ligados.

import json

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.domain.claims import kinds
from app.domain.claims.repositories import ClaimRepository
from app.extensions import db
from app.infrastructure.persistence.repositories.place_cards import fetch_place_cards
from app.infrastructure.persistence.repositories.place_notifications import PlaceNotifierMixin

_CLAIM_COLUMNS = (
    "c.id, c.place_id, c.claimant_id, c.status, c.business_name, c.contact_phone, c.message, "
    "c.document_key, c.document_content_type, c.reviewed_at, c.review_note, c.created_at, "
    "c.updated_at"
)

_OTHER_REJECTED_NOTE = "Otro reclamo de este lugar fue aprobado."


class SQLAlchemyClaimRepository(PlaceNotifierMixin, ClaimRepository):
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

    def is_manager(self, place_id, user_id):
        return (
            db.session.execute(
                text("SELECT 1 FROM place_managers WHERE place_id = :p AND user_id = :u"),
                {"p": str(place_id), "u": str(user_id)},
            ).first()
            is not None
        )

    def place_has_manager(self, place_id):
        return (
            db.session.execute(
                text("SELECT 1 FROM place_managers WHERE place_id = :p LIMIT 1"),
                {"p": str(place_id)},
            ).first()
            is not None
        )

    def count_pending(self, user_id):
        return db.session.execute(
            text("SELECT count(*) FROM place_claims WHERE claimant_id = :u AND status = 'pending'"),
            {"u": str(user_id)},
        ).scalar()

    def create_claim(self, place_id, claimant_id, business_name, contact_phone, message,
                     document_key, document_content_type):
        try:
            row = db.session.execute(
                text(
                    "INSERT INTO place_claims (place_id, claimant_id, business_name, "
                    "contact_phone, message, document_key, document_content_type) "
                    "VALUES (:p, :u, :name, :phone, :message, :key, :ctype) RETURNING id"
                ),
                {
                    "p": str(place_id), "u": str(claimant_id), "name": business_name,
                    "phone": contact_phone, "message": message, "key": document_key,
                    "ctype": document_content_type,
                },
            ).first()
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            return None
        return row[0]

    def list_for_claimant(self, claimant_id, limit):
        rows = db.session.execute(
            text(
                f"SELECT {_CLAIM_COLUMNS} FROM place_claims c WHERE c.claimant_id = :u "
                "ORDER BY c.created_at DESC, c.id LIMIT :limit"
            ),
            {"u": str(claimant_id), "limit": limit},
        ).mappings()
        return [dict(row) for row in rows]

    def get_claim(self, claim_id):
        row = db.session.execute(
            text(f"SELECT {_CLAIM_COLUMNS} FROM place_claims c WHERE c.id = :id"),
            {"id": str(claim_id)},
        ).mappings().first()
        return dict(row) if row else None

    def withdraw(self, claim_id, claimant_id):
        row = db.session.execute(
            text(
                "SELECT document_key FROM place_claims "
                "WHERE id = :id AND claimant_id = :u AND status = 'pending' FOR UPDATE"
            ),
            {"id": str(claim_id), "u": str(claimant_id)},
        ).first()
        if row is None:
            db.session.rollback()
            return False
        db.session.execute(
            text(
                "UPDATE place_claims SET status = 'withdrawn', document_key = NULL, "
                "document_content_type = NULL, updated_at = now() WHERE id = :id"
            ),
            {"id": str(claim_id)},
        )
        db.session.commit()
        return row[0] or True

    def get_for_review(self, claim_id):
        row = db.session.execute(
            text(
                f"SELECT {_CLAIM_COLUMNS}, p.name AS place_name, p.municipality, "
                "u.username AS claimant_username, u.name AS claimant_name "
                "FROM place_claims c JOIN places p ON p.id = c.place_id "
                "JOIN users u ON u.id = c.claimant_id WHERE c.id = :id"
            ),
            {"id": str(claim_id)},
        ).mappings().first()
        return dict(row) if row else None

    def list_for_review(self, status, limit, offset):
        where = "WHERE c.status = :status" if status else ""
        order = "c.created_at ASC" if status == kinds.CLAIM_PENDING else "c.created_at DESC"
        rows = db.session.execute(
            text(
                f"SELECT {_CLAIM_COLUMNS}, p.name AS place_name, p.municipality, "
                "u.username AS claimant_username, u.name AS claimant_name "
                "FROM place_claims c JOIN places p ON p.id = c.place_id "
                "JOIN users u ON u.id = c.claimant_id "
                f"{where} ORDER BY {order}, c.id LIMIT :limit OFFSET :offset"
            ),
            {"status": status, "limit": limit + 1, "offset": offset},
        ).mappings()
        return [dict(row) for row in rows]

    def decide(self, claim_id, reviewer_id, approve, note):
        claim = db.session.execute(
            text(
                "SELECT id, place_id, claimant_id, document_key FROM place_claims "
                "WHERE id = :id AND status = 'pending' FOR UPDATE"
            ),
            {"id": str(claim_id)},
        ).mappings().first()
        if claim is None:
            db.session.rollback()
            return None

        released = [claim["document_key"]] if claim["document_key"] else []
        status = kinds.CLAIM_APPROVED if approve else kinds.CLAIM_REJECTED
        db.session.execute(
            text(
                "UPDATE place_claims SET status = :status, reviewed_by = :rev, "
                "reviewed_at = now(), review_note = :note, document_key = NULL, "
                "document_content_type = NULL, updated_at = now() WHERE id = :id"
            ),
            {"status": status, "rev": str(reviewer_id), "note": note, "id": str(claim_id)},
        )
        if approve:
            db.session.execute(
                text(
                    "INSERT INTO place_managers (place_id, user_id, claim_id, granted_by) "
                    "VALUES (:p, :u, :c, :rev) ON CONFLICT (place_id, user_id) DO NOTHING"
                ),
                {"p": str(claim["place_id"]), "u": str(claim["claimant_id"]),
                 "c": str(claim_id), "rev": str(reviewer_id)},
            )
            # El resto de reclamos pendientes del lugar queda rechazado con un motivo fijo.
            others = db.session.execute(
                text(
                    "SELECT id, document_key FROM place_claims "
                    "WHERE place_id = :p AND status = 'pending' AND id <> :id FOR UPDATE"
                ),
                {"p": str(claim["place_id"]), "id": str(claim_id)},
            ).all()
            for other_id, other_key in others:
                db.session.execute(
                    text(
                        "UPDATE place_claims SET status = 'rejected', reviewed_by = :rev, "
                        "reviewed_at = now(), review_note = :note, document_key = NULL, "
                        "document_content_type = NULL, updated_at = now() WHERE id = :id"
                    ),
                    {"rev": str(reviewer_id), "note": _OTHER_REJECTED_NOTE, "id": str(other_id)},
                )
                if other_key:
                    released.append(other_key)

        self._audit(
            reviewer_id,
            kinds.AUDIT_CLAIM_APPROVED if approve else kinds.AUDIT_CLAIM_REJECTED,
            claim_id,
            {"place_id": str(claim["place_id"]), "claimant_id": str(claim["claimant_id"]),
             "note": note},
        )
        db.session.commit()
        # Para avisar a quien reclamó y a quienes quedaron rechazados por la aprobación.
        affected = [(claim_id, claim["claimant_id"], status)]
        if approve:
            for other_id, _key in others:
                other_claimant = db.session.execute(
                    text("SELECT claimant_id FROM place_claims WHERE id = :id"), {"id": str(other_id)}
                ).scalar()
                affected.append((other_id, other_claimant, kinds.CLAIM_REJECTED))
        return {
            "claim": self.get_claim(claim_id),
            "released_keys": released,
            "place_id": claim["place_id"],
            "affected": affected,
        }

    def record_document_view(self, claim_id, reviewer_id):
        self._audit(reviewer_id, kinds.AUDIT_CLAIM_DOCUMENT_VIEWED, claim_id, {})
        db.session.commit()

    @staticmethod
    def _audit(actor_id, action, claim_id, changes):
        """En la MISMA transacción que el cambio: o quedan los dos o ninguno."""
        db.session.execute(
            text(
                "INSERT INTO admin_audit_log (actor_id, action, resource_type, resource_id, changes) "
                "VALUES (:actor, :action, 'place_claim', :rid, CAST(:changes AS jsonb))"
            ),
            {"actor": str(actor_id), "action": action, "rid": str(claim_id),
             "changes": json.dumps(changes, ensure_ascii=False, default=str)},
        )
