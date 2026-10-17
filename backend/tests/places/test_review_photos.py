# Fotos en reseñas de lugares (ADR-040 fase 4b): subir, límite, quitar, privacidad del
# archivo, limpieza del almacenamiento (borrar reseña, moderación, cuenta) y validación.

import io
import os

import pytest
from PIL import Image
from sqlalchemy import text

from app.domain.rate_limiting import policy
from app.extensions import db
from tests.places.helpers import auth, insert_place, make_users
from tests.test_moderation import _queue, _resolve
from tests.test_reports import _report

MISSING = "00000000-0000-4000-8000-000000000000"


def _png(width=40, height=30, color=(200, 30, 30)):
    out = io.BytesIO()
    Image.new("RGB", (width, height), color).save(out, format="PNG")
    return out.getvalue()


def _file(raw=None, name="foto.png"):
    return io.BytesIO(raw if raw is not None else _png()), name


def _files():
    found = []
    for folder, _, names in os.walk(os.environ["UPLOAD_DIR"]):
        found += [os.path.join(folder, n) for n in names if folder.endswith("reviews")]
    return found


def _upload(client, token, place_id, images):
    return client.post(
        f"/api/places/{place_id}/review/images",
        data={"images": images},
        content_type="multipart/form-data",
        headers=auth(token),
    )


def _photo_rows(app, where="TRUE"):
    with app.app_context():
        return db.session.execute(
            text(f"SELECT count(*) FROM media_attachments WHERE review_id IS NOT NULL AND {where}")
        ).scalar()


@pytest.fixture()
def world(app, client):
    users = make_users(app, client, with_moderator=True)
    with app.app_context():
        place_id = insert_place("Café Aurora")
    client.put(f"/api/places/{place_id}/review", json={"rating": 4, "body": "Rico"}, headers=auth(users["ana"][0]))
    return users, place_id


def test_upload_a_photo(client, world):
    users, place_id = world

    response = _upload(client, users["ana"][0], place_id, [_file()])

    assert response.status_code == 201
    images = response.get_json()["images"]
    assert len(images) == 1
    assert set(images[0]) == {"id", "url", "width", "height"}  # nunca la clave interna ni el dueño
    assert (images[0]["width"], images[0]["height"]) == (40, 30)
    assert len(_files()) == 1


def test_photos_show_in_the_public_list(client, world):
    users, place_id = world
    _upload(client, users["ana"][0], place_id, [_file(), _file(_png(20, 20, (0, 200, 0)))])

    reviews = client.get(f"/api/places/{place_id}/reviews").get_json()["reviews"]

    assert [(i["width"], i["height"]) for i in reviews[0]["images"]] == [(40, 30), (20, 20)]


def test_reviews_without_photos_have_an_empty_list(client, world):
    _, place_id = world
    assert client.get(f"/api/places/{place_id}/reviews").get_json()["reviews"][0]["images"] == []


def test_writing_the_review_again_keeps_its_photos(client, world):
    users, place_id = world
    token = users["ana"][0]
    _upload(client, token, place_id, [_file()])
    updated = client.put(f"/api/places/{place_id}/review", json={"rating": 5}, headers=auth(token))
    assert updated.status_code == 200
    assert len(updated.get_json()["review"]["images"]) == 1


def test_limit_is_three_photos_per_review(client, app, world):
    users, place_id = world
    token = users["ana"][0]
    assert _upload(client, token, place_id, [_file(), _file(), _file()]).status_code == 201

    over = _upload(client, token, place_id, [_file()])

    assert over.status_code == 400
    assert "3" in over.get_json()["msg"]
    assert _photo_rows(app) == 3
    assert len(_files()) == 3  # la subida rechazada no dejó archivos huérfanos


def test_four_photos_at_once_are_rejected_before_processing(client, app, world):
    users, place_id = world
    response = _upload(client, users["ana"][0], place_id, [_file() for _ in range(4)])
    assert response.status_code == 400
    assert _photo_rows(app) == 0 and _files() == []


def test_a_photo_needs_an_existing_review(client, app, world):
    users, place_id = world
    response = _upload(client, users["beto"][0], place_id, [_file()])
    assert response.status_code == 404
    assert _photo_rows(app) == 0 and _files() == []


def test_requires_a_session_and_at_least_one_file(client, world):
    users, place_id = world
    anonymous = client.post(f"/api/places/{place_id}/review/images", data={"images": [_file()]}, content_type="multipart/form-data")
    assert anonymous.status_code == 401
    empty = client.post(f"/api/places/{place_id}/review/images", data={}, content_type="multipart/form-data", headers=auth(users["ana"][0]))
    assert empty.status_code == 400


def test_non_public_or_missing_place_is_404(client, app, world):
    users, _ = world
    with app.app_context():
        pending = insert_place("Pendiente", status="pending")
    for place_id in (MISSING, pending):
        assert _upload(client, users["ana"][0], place_id, [_file()]).status_code == 404


@pytest.mark.parametrize(
    "raw,name",
    [(b"no soy una imagen", "x.png"), (b"<?php echo 1; ?>", "shell.php"), (b"GIF89a....", "x.gif"), (b"", "vacio.png")],
)
def test_invalid_files_are_rejected_and_nothing_is_stored(client, app, world, raw, name):
    users, place_id = world
    response = _upload(client, users["ana"][0], place_id, [_file(raw, name)])
    assert response.status_code == 400
    assert _photo_rows(app) == 0 and _files() == []


def test_one_bad_file_cancels_the_whole_request(client, app, world):
    users, place_id = world
    response = _upload(client, users["ana"][0], place_id, [_file(), _file(b"basura", "x.png")])
    assert response.status_code == 400
    assert _photo_rows(app) == 0 and _files() == []


def test_exif_is_stripped_and_the_file_is_reencoded_as_webp(client, world):
    users, place_id = world
    out = io.BytesIO()
    image = Image.new("RGB", (30, 30), (1, 2, 3))
    exif = Image.Exif()
    exif[0x010F] = "CamaraSecreta"
    image.save(out, format="JPEG", exif=exif)

    assert _upload(client, users["ana"][0], place_id, [_file(out.getvalue(), "g.jpg")]).status_code == 201
    stored = _files()[0]
    assert stored.endswith(".webp")
    with Image.open(stored) as saved:
        assert saved.format == "WEBP"
        assert b"CamaraSecreta" not in open(stored, "rb").read()


def test_the_owner_can_remove_a_photo_and_its_file_goes(client, app, world):
    users, place_id = world
    token = users["ana"][0]
    image_id = _upload(client, token, place_id, [_file()]).get_json()["images"][0]["id"]

    response = client.delete(f"/api/places/{place_id}/review/images/{image_id}", headers=auth(token))

    assert response.status_code == 200
    assert _photo_rows(app) == 0 and _files() == []


def test_nobody_else_can_remove_a_photo(client, app, world):
    users, place_id = world
    image_id = _upload(client, users["ana"][0], place_id, [_file()]).get_json()["images"][0]["id"]
    client.put(f"/api/places/{place_id}/review", json={"rating": 2}, headers=auth(users["beto"][0]))

    response = client.delete(f"/api/places/{place_id}/review/images/{image_id}", headers=auth(users["beto"][0]))

    assert response.status_code == 404
    assert _photo_rows(app) == 1 and len(_files()) == 1
    assert client.delete(f"/api/places/{place_id}/review/images/{MISSING}", headers=auth(users["ana"][0])).status_code == 404


def test_deleting_the_review_deletes_its_photos_and_files(client, app, world):
    users, place_id = world
    token = users["ana"][0]
    _upload(client, token, place_id, [_file(), _file()])
    assert len(_files()) == 2

    assert client.delete(f"/api/places/{place_id}/review", headers=auth(token)).status_code == 200

    assert _photo_rows(app) == 0 and _files() == []


def test_moderation_removal_deletes_photos_and_files(client, app, world):
    users, place_id = world
    _upload(client, users["ana"][0], place_id, [_file()])
    review_id = client.get(f"/api/places/{place_id}/reviews").get_json()["reviews"][0]["id"]
    _report(client, users["beto"][0], "review", review_id)
    report_id = _queue(client, users["mod"][0]).get_json()["reports"][0]["id"]

    assert _resolve(client, users["mod"][0], report_id, "remove_content").status_code == 200

    assert _photo_rows(app) == 0 and _files() == []


def test_hiding_a_review_hides_its_photos_from_the_public(client, world):
    users, place_id = world
    _upload(client, users["ana"][0], place_id, [_file()])
    review_id = client.get(f"/api/places/{place_id}/reviews").get_json()["reviews"][0]["id"]

    client.post(f"/api/moderation/places/reviews/{review_id}/visibility", json={"hidden": True}, headers=auth(users["mod"][0]))

    assert client.get(f"/api/places/{place_id}/reviews").get_json()["reviews"] == []


def test_deleting_the_account_collects_the_review_photo_files(client, app, world):
    users, place_id = world
    _upload(client, users["ana"][0], place_id, [_file()])
    from app.infrastructure.persistence.repositories.account_deletion_repository import (
        SQLAlchemyAccountDeleter,
    )
    from app.infrastructure.persistence.repositories.rate_limit_repository import (
        SQLAlchemyRateLimitRepository,
    )

    with app.app_context():
        result = SQLAlchemyAccountDeleter(SQLAlchemyRateLimitRepository()).delete_account(users["ana"][1])

    # Las filas caen en cascada; los ARCHIVOS los borra quien llama con estas claves.
    assert len(result["media_keys"]) == 1 and result["media_keys"][0].startswith("reviews/")
    assert _photo_rows(app) == 0


def test_photo_uploads_are_rate_limited_per_account(client, world):
    users, place_id = world
    token = users["ana"][0]
    # Cada subida cuenta contra el límite de reseñas (20/h, ya con 1 usado por escribir la
    # reseña) y contra el de imágenes (40/h): gana el más estricto.
    statuses = [_upload(client, token, place_id, [_file()]).status_code for _ in range(policy.PLACE_REVIEW.limit)]
    assert statuses[-1] == 429
    assert 429 not in statuses[:-1]
    limited = _upload(client, token, place_id, [_file()])
    assert limited.status_code == 429 and "Retry-After" in limited.headers
    # Otra cuenta no se ve afectada.
    client.put(f"/api/places/{place_id}/review", json={"rating": 3}, headers=auth(users["beto"][0]))
    assert _upload(client, users["beto"][0], place_id, [_file()]).status_code == 201
