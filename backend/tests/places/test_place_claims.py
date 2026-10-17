# Reclamos de negocio (ADR-040 fase 6): documento en almacenamiento PRIVADO, revisión solo por
# moderación con URL firmada y auditoría, rol de gestor distinto de moderador, borrado del
# documento al resolver, límites, exportación y eliminación de cuenta.

import io
import os

import pytest
from PIL import Image
from sqlalchemy import text

from app.extensions import db
from tests.places.helpers import auth, insert_place, make_users

MISSING = "00000000-0000-4000-8000-000000000000"
PDF = b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n"


def _png(size=(40, 30)):
    buffer = io.BytesIO()
    Image.new("RGB", size, (200, 30, 30)).save(buffer, format="PNG")
    return buffer.getvalue()


def _claim(client, token, place_id, document=("doc.png", None), **fields):
    data = {"business_name": "Café Aurora S.A.", "message": "Soy la dueña", **fields}
    if document is not None:
        name, content = document
        data["document"] = (io.BytesIO(content if content is not None else _png()), name)
    return client.post(
        f"/api/places/{place_id}/claims", data=data, headers=auth(token),
        content_type="multipart/form-data",
    )


def _private_files():
    root = os.environ["PRIVATE_UPLOAD_DIR"]
    return [os.path.join(d, f) for d, _, files in os.walk(root) for f in files]


def _scalar(app, sql, **params):
    with app.app_context():
        return db.session.execute(text(sql), params).scalar()


@pytest.fixture()
def world(app, client):
    users = make_users(app, client, with_moderator=True)
    with app.app_context():
        place_id = insert_place("Café Aurora", municipality="San Salvador")
    return users, place_id


# --- Reclamar ----------------------------------------------------------------


def test_claim_a_place_with_an_image_document(client, app, world):
    users, place_id = world
    response = _claim(client, users["ana"][0], place_id, contact_phone="+503 2222 3333")

    assert response.status_code == 201
    claim = response.get_json()["claim"]
    assert claim["status"] == "pending"
    assert claim["business_name"] == "Café Aurora S.A."
    assert claim["contact_phone"] == "+503 2222 3333"
    assert claim["place"]["name"] == "Café Aurora"
    # La clave del documento nunca viaja.
    assert "document_key" not in claim and "document" not in claim
    assert len(_private_files()) == 1
    # El documento NO queda en el directorio público de medios.
    public_root = os.environ["UPLOAD_DIR"]
    assert not [f for _, _, files in os.walk(public_root) for f in files]


def test_the_document_is_reencoded_as_webp(client, world):
    users, place_id = world
    _claim(client, users["ana"][0], place_id)
    (path,) = _private_files()
    assert path.endswith(".webp")
    with open(path, "rb") as stored:
        assert stored.read(4) == b"RIFF"


def test_a_pdf_document_is_accepted(client, world):
    users, place_id = world
    response = _claim(client, users["ana"][0], place_id, document=("doc.pdf", PDF))
    assert response.status_code == 201
    assert _private_files()[0].endswith(".pdf")


@pytest.mark.parametrize(
    "content",
    [
        b"%PDF-1.4\n<< /JavaScript (app.alert(1)) >>\n%%EOF",
        b"%PDF-1.4\n<< /OpenAction 1 0 R >>\n%%EOF",
        b"not an image at all",
        b"GIF89a....",
    ],
)
def test_unsafe_or_invalid_documents_are_rejected(client, world, content):
    users, place_id = world
    response = _claim(client, users["ana"][0], place_id, document=("x.bin", content))
    assert response.status_code == 400
    assert _private_files() == []


def test_the_document_is_required(client, world):
    users, place_id = world
    response = _claim(client, users["ana"][0], place_id, document=None)
    assert response.status_code == 400


def test_a_document_over_the_limit_is_rejected(client, world):
    users, place_id = world
    response = _claim(
        client, users["ana"][0], place_id, document=("big.pdf", b"%PDF-" + b"0" * (5 * 1024 * 1024))
    )
    assert response.status_code == 400
    assert _private_files() == []


@pytest.mark.parametrize(
    "fields",
    [
        {"business_name": ""},
        {"business_name": "x" * 161},
        {"business_name": "Línea\nnueva"},
        {"message": "x" * 501},
        {"contact_phone": "llámame"},
    ],
)
def test_invalid_fields_are_rejected(client, world, fields):
    users, place_id = world
    assert _claim(client, users["ana"][0], place_id, **fields).status_code == 400
    assert _private_files() == []


def test_requires_a_session(client, world):
    _, place_id = world
    assert client.post(f"/api/places/{place_id}/claims").status_code == 401
    assert client.get("/api/users/me/claims").status_code == 401


def test_only_public_places_can_be_claimed(client, app, world):
    users, _ = world
    with app.app_context():
        hidden = insert_place("Oculto", active=False)
        pending = insert_place("Pendiente", status="pending")
    for place_id in (hidden, pending, MISSING):
        assert _claim(client, users["ana"][0], place_id).status_code == 404


def test_one_pending_claim_per_place_and_person(client, world):
    users, place_id = world
    assert _claim(client, users["ana"][0], place_id).status_code == 201
    second = _claim(client, users["ana"][0], place_id)
    assert second.status_code == 409
    assert len(_private_files()) == 1  # el segundo archivo no queda huérfano


def test_pending_claims_per_person_are_capped(client, app, world):
    users, _ = world
    with app.app_context():
        places = [insert_place(f"Local {i}") for i in range(4)]
    statuses = [_claim(client, users["ana"][0], p).status_code for p in places]
    assert statuses == [201, 201, 201, 409]


def test_claims_are_rate_limited(client, app, world, monkeypatch):
    from app.domain.rate_limiting import policy
    from app.domain.rate_limiting.policy import RateLimitRule

    monkeypatch.setattr(policy, "CLAIM_WRITE", RateLimitRule("claim_write", 1, 3600, clear_on_success=False))
    users, place_id = world
    assert _claim(client, users["ana"][0], place_id).status_code == 201
    assert _claim(client, users["ana"][0], place_id).status_code == 429


def test_identity_comes_from_the_token_not_the_body(client, app, world):
    users, place_id = world
    _claim(client, users["ana"][0], place_id, claimant_id=users["beto"][1], status="approved")
    row = _scalar(app, "SELECT claimant_id::text || status FROM place_claims")
    assert row == users["ana"][1] + "pending"


# --- Mis reclamos y retirar ---------------------------------------------------------


def test_list_own_claims_only(client, world):
    users, place_id = world
    _claim(client, users["ana"][0], place_id)

    mine = client.get("/api/users/me/claims", headers=auth(users["ana"][0])).get_json()["claims"]
    other = client.get("/api/users/me/claims", headers=auth(users["beto"][0])).get_json()["claims"]
    assert len(mine) == 1 and mine[0]["status"] == "pending"
    assert other == []


def test_withdraw_deletes_the_document(client, world):
    users, place_id = world
    claim = _claim(client, users["ana"][0], place_id).get_json()["claim"]

    response = client.delete(f"/api/claims/{claim['id']}", headers=auth(users["ana"][0]))
    assert response.status_code == 200
    assert response.get_json()["claim"]["status"] == "withdrawn"
    assert _private_files() == []
    # Retirado: se puede volver a reclamar.
    assert _claim(client, users["ana"][0], place_id).status_code == 201


def test_withdraw_is_only_for_the_owner_and_only_when_pending(client, world):
    users, place_id = world
    claim = _claim(client, users["ana"][0], place_id).get_json()["claim"]

    assert client.delete(f"/api/claims/{claim['id']}", headers=auth(users["beto"][0])).status_code == 404
    assert client.delete(f"/api/claims/{MISSING}", headers=auth(users["ana"][0])).status_code == 404
    client.delete(f"/api/claims/{claim['id']}", headers=auth(users["ana"][0]))
    assert client.delete(f"/api/claims/{claim['id']}", headers=auth(users["ana"][0])).status_code == 409


# --- Moderación ----------------------------------------------------------------------


def test_review_routes_are_hidden_from_everyone_but_moderators(client, world):
    users, place_id = world
    claim = _claim(client, users["ana"][0], place_id).get_json()["claim"]
    base = "/api/moderation/place-claims"

    for method, path in (
        ("get", base), ("get", f"{base}/{claim['id']}"),
        ("post", f"{base}/{claim['id']}/document-url"),
        ("post", f"{base}/{claim['id']}/approve"), ("post", f"{base}/{claim['id']}/reject"),
    ):
        assert getattr(client, method)(path, headers=auth(users["ana"][0])).status_code == 404
        assert getattr(client, method)(path).status_code == 401


def test_moderator_lists_and_reads_pending_claims(client, world):
    users, place_id = world
    claim = _claim(client, users["ana"][0], place_id).get_json()["claim"]
    mod = auth(users["mod"][0])

    listing = client.get("/api/moderation/place-claims?status=pending", headers=mod).get_json()
    assert [c["id"] for c in listing["claims"]] == [claim["id"]]
    row = listing["claims"][0]
    assert row["claimant"]["id"] == users["ana"][1]
    assert row["has_document"] is True
    assert "document_key" not in row
    assert client.get(f"/api/moderation/place-claims/{claim['id']}", headers=mod).status_code == 200
    assert client.get("/api/moderation/place-claims?status=raro", headers=mod).status_code == 400


def test_signed_document_url_works_and_is_audited(client, app, world):
    users, place_id = world
    claim = _claim(client, users["ana"][0], place_id, document=("d.pdf", PDF)).get_json()["claim"]

    response = client.post(
        f"/api/moderation/place-claims/{claim['id']}/document-url", headers=auth(users["mod"][0])
    )
    assert response.status_code == 200
    document = response.get_json()["document"]
    assert document["content_type"] == "application/pdf"
    assert document["expires_in"] == 300
    assert response.headers["Cache-Control"] == "no-store"

    token_path = document["url"].split("/api", 1)[1]
    download = client.get("/api" + token_path)  # sin sesión: el token ES la autorización
    assert download.status_code == 200
    assert download.data == PDF
    assert download.headers["Content-Disposition"] == "attachment"
    assert download.headers["Cache-Control"] == "private, no-store"
    assert download.headers["X-Content-Type-Options"] == "nosniff"

    audited = _scalar(
        app,
        "SELECT count(*) FROM admin_audit_log WHERE action = 'place_claim_document_viewed' "
        "AND resource_id = :id AND actor_id = :actor",
        id=claim["id"], actor=users["mod"][1],
    )
    assert audited == 1


def test_private_document_tokens_cannot_be_forged_or_expire(client, world, monkeypatch):
    users, place_id = world
    claim = _claim(client, users["ana"][0], place_id).get_json()["claim"]
    document = client.post(
        f"/api/moderation/place-claims/{claim['id']}/document-url", headers=auth(users["mod"][0])
    ).get_json()["document"]
    token = document["url"].rsplit("/", 1)[1]

    assert client.get("/api/private-documents/basura").status_code == 404
    assert client.get(f"/api/private-documents/{token[:-3]}abc").status_code == 404
    assert client.get("/api/private-documents/claims/x.webp").status_code == 404

    from app.domain.claims import kinds

    monkeypatch.setattr(kinds, "DOCUMENT_URL_TTL_SECONDS", -1)
    assert client.get(f"/api/private-documents/{token}").status_code == 404


def test_approve_makes_the_claimant_a_manager_and_deletes_the_document(client, app, world):
    users, place_id = world
    claim = _claim(client, users["ana"][0], place_id).get_json()["claim"]

    response = client.post(
        f"/api/moderation/place-claims/{claim['id']}/approve", json={"note": "Documento válido"},
        headers=auth(users["mod"][0]),
    )
    assert response.status_code == 200
    assert response.get_json()["claim"]["status"] == "approved"
    assert _private_files() == []
    assert _scalar(
        app, "SELECT count(*) FROM place_managers WHERE place_id = :p AND user_id = :u",
        p=place_id, u=users["ana"][1],
    ) == 1
    assert _scalar(
        app, "SELECT count(*) FROM admin_audit_log WHERE action = 'place_claim_approved'"
    ) == 1
    # Ser gestor no convierte a nadie en moderador.
    assert _scalar(app, "SELECT is_moderator FROM users WHERE id = :u", u=users["ana"][1]) is False

    detail = client.get(f"/api/places/{place_id}", headers=auth(users["ana"][0])).get_json()["place"]
    assert detail["is_claimed"] is True and detail["managed_by_me"] is True
    other = client.get(f"/api/places/{place_id}", headers=auth(users["beto"][0])).get_json()["place"]
    assert other["is_claimed"] is True and other["managed_by_me"] is False

    # El lugar ya tiene gestor: nadie más puede reclamarlo, ni quien ya lo gestiona.
    assert _claim(client, users["beto"][0], place_id).status_code == 409
    assert _claim(client, users["ana"][0], place_id).status_code == 409
    # El documento ya no existe.
    assert client.post(
        f"/api/moderation/place-claims/{claim['id']}/document-url", headers=auth(users["mod"][0])
    ).status_code == 409


def test_approving_rejects_the_other_pending_claims_of_the_place(client, app, world):
    users, place_id = world
    first = _claim(client, users["ana"][0], place_id).get_json()["claim"]
    second = _claim(client, users["beto"][0], place_id).get_json()["claim"]
    assert len(_private_files()) == 2

    client.post(f"/api/moderation/place-claims/{first['id']}/approve", headers=auth(users["mod"][0]))

    mine = client.get("/api/users/me/claims", headers=auth(users["beto"][0])).get_json()["claims"]
    assert mine[0]["id"] == second["id"]
    assert mine[0]["status"] == "rejected"
    assert mine[0]["review_note"] == "Otro reclamo de este lugar fue aprobado."
    assert _private_files() == []


def test_reject_requires_a_note_and_the_claimant_sees_it(client, app, world):
    users, place_id = world
    claim = _claim(client, users["ana"][0], place_id).get_json()["claim"]
    mod = auth(users["mod"][0])
    url = f"/api/moderation/place-claims/{claim['id']}/reject"

    assert client.post(url, json={}, headers=mod).status_code == 400
    assert client.post(url, json={"note": "x" * 501}, headers=mod).status_code == 400
    response = client.post(url, json={"note": "El documento no se lee"}, headers=mod)
    assert response.status_code == 200
    assert response.get_json()["claim"]["status"] == "rejected"
    assert _private_files() == []
    assert _scalar(app, "SELECT count(*) FROM place_managers") == 0

    mine = client.get("/api/users/me/claims", headers=auth(users["ana"][0])).get_json()["claims"]
    assert mine[0]["review_note"] == "El documento no se lee"
    # Una vez resuelto no se puede volver a resolver.
    assert client.post(url, json={"note": "otra"}, headers=mod).status_code == 409
    assert client.post(
        f"/api/moderation/place-claims/{MISSING}/reject", json={"note": "x"}, headers=mod
    ).status_code == 404
    # Tras un rechazo se puede reclamar de nuevo.
    assert _claim(client, users["ana"][0], place_id).status_code == 201


def test_a_suspended_or_non_moderator_cannot_review(client, app, world):
    users, place_id = world
    claim = _claim(client, users["ana"][0], place_id).get_json()["claim"]
    response = client.post(
        f"/api/moderation/place-claims/{claim['id']}/approve", headers=auth(users["beto"][0])
    )
    assert response.status_code == 404
    assert _scalar(app, "SELECT count(*) FROM place_managers") == 0


# --- Exportación y eliminación de cuenta -------------------------------------------------


def test_data_export_includes_claims_without_the_document(client, app, world):
    users, place_id = world
    claim = _claim(client, users["ana"][0], place_id).get_json()["claim"]
    client.post(f"/api/moderation/place-claims/{claim['id']}/approve", headers=auth(users["mod"][0]))

    from app.infrastructure.persistence.repositories.data_export_repository import (
        SQLAlchemyDataExportRepository,
    )

    with app.app_context():
        data = SQLAlchemyDataExportRepository().collect_user_data(users["ana"][1])
    assert [c["place"] for c in data["place_claims"]] == ["Café Aurora"]
    assert data["place_claims"][0]["status"] == "approved"
    assert not any("document" in key for key in data["place_claims"][0])
    assert [m["place"] for m in data["managed_places"]] == ["Café Aurora"]


def test_deleting_the_claimant_removes_claims_and_the_document(client, app, world):
    from app.infrastructure.persistence.repositories.account_deletion_repository import (
        SQLAlchemyAccountDeleter,
    )
    from app.infrastructure.persistence.repositories.rate_limit_repository import (
        SQLAlchemyRateLimitRepository,
    )

    users, place_id = world
    _claim(client, users["ana"][0], place_id)
    with app.app_context():
        result = SQLAlchemyAccountDeleter(SQLAlchemyRateLimitRepository()).delete_account(
            users["ana"][1]
        )
    assert len(result["private_keys"]) == 1
    app.extensions["private_storage"].delete(result["private_keys"][0])
    assert _scalar(app, "SELECT count(*) FROM place_claims") == 0
    assert _private_files() == []


def test_without_private_storage_claims_are_unavailable(client, app, world):
    users, place_id = world
    original = app.extensions["private_storage"]
    app.extensions["private_storage"] = None
    try:
        assert _claim(client, users["ana"][0], place_id).status_code == 503
    finally:
        app.extensions["private_storage"] = original
