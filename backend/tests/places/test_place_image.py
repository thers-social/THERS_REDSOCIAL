# Imagen que identifica a un lugar (ADR-046): la sube quien lo gestiona; el servidor la re-codifica y
# la expone como `cover_image_url`. Contra PostgreSQL real y almacenamiento local temporal.

import io
import os

import pytest
from PIL import Image
from sqlalchemy import text

from app.extensions import db
from tests.places.helpers import REF_LAT, REF_LNG, auth, insert_place, make_users

MEDIA_PREFIX = "http://testserver/api/media/"


def _png(width=40, height=30, color=(200, 30, 30)):
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), color).save(buffer, format="PNG")
    return buffer.getvalue()


def _jpeg_with_gps():
    buffer = io.BytesIO()
    exif = Image.Exif()
    exif[0x8825] = {1: "N", 2: (13.0, 41.0, 30.0)}  # GPSInfo
    Image.new("RGB", (60, 40), (10, 120, 10)).save(buffer, format="JPEG", exif=exif)
    return buffer.getvalue()


def _stored_files():
    files = []
    for folder, _, names in os.walk(os.environ["UPLOAD_DIR"]):
        files += [os.path.join(folder, name) for name in names]
    return files


def _put(client, token, place_id, data=None, name="logo.png"):
    body = {} if data is None else {"image": (io.BytesIO(data), name)}
    return client.put(
        f"/api/places/{place_id}/manage/image",
        data=body,
        content_type="multipart/form-data",
        headers=auth(token),
    )


@pytest.fixture()
def world(app, client):
    users = make_users(app, client, with_moderator=True)  # ana gestiona; beto y mod no
    with app.app_context():
        place_id = insert_place("Café Aurora", lat=REF_LAT, lng=REF_LNG)
        other_id = insert_place("Otro lugar")
        db.session.execute(
            text("INSERT INTO place_managers (place_id, user_id) VALUES (:p, :u)"),
            {"p": place_id, "u": users["ana"][1]},
        )
        db.session.commit()
    return users, place_id, other_id


class TestUpload:
    def test_a_place_has_no_image_by_default(self, client, world):
        users, place_id, _ = world
        detail = client.get(f"/api/places/{place_id}", headers=auth(users["beto"][0])).get_json()["place"]
        assert detail["cover_image_url"] is None

    def test_the_manager_sets_the_image_and_everyone_sees_it(self, client, world):
        users, place_id, _ = world

        response = _put(client, users["ana"][0], place_id, _png())

        assert response.status_code == 200
        url = response.get_json()["place"]["cover_image_url"]
        assert url.startswith(MEDIA_PREFIX + "places/") and url.endswith(".webp")
        assert len(_stored_files()) == 1
        # Detalle, listados y búsqueda lo traen.
        detail = client.get(f"/api/places/{place_id}", headers=auth(users["beto"][0])).get_json()["place"]
        assert detail["cover_image_url"] == url
        nearby = client.get(
            "/api/places/nearby", query_string={"lat": REF_LAT, "lng": REF_LNG, "radius": 1000}
        ).get_json()["places"]
        assert {p["id"]: p["cover_image_url"] for p in nearby}[place_id] == url
        found = client.get("/api/places/search", query_string={"q": "aurora"}).get_json()["places"]
        assert found[0]["cover_image_url"] == url

    def test_the_stored_file_is_a_clean_webp_without_gps_data(self, client, world):
        users, place_id, _ = world
        url = _put(client, users["ana"][0], place_id, _jpeg_with_gps(), "foto.jpg").get_json()["place"][
            "cover_image_url"
        ]

        stored = client.get("/api/media/" + url[len(MEDIA_PREFIX):])

        assert stored.status_code == 200 and stored.headers["Content-Type"].startswith("image/webp")
        image = Image.open(io.BytesIO(stored.data))
        assert image.format == "WEBP"
        assert not image.getexif().get(0x8825)

    def test_big_images_are_reduced_to_1200_px(self, client, world):
        users, place_id, _ = world
        url = _put(client, users["ana"][0], place_id, _png(3000, 1500)).get_json()["place"]["cover_image_url"]

        image = Image.open(io.BytesIO(client.get("/api/media/" + url[len(MEDIA_PREFIX):]).data))

        assert max(image.size) == 1200

    def test_replacing_deletes_the_previous_file(self, client, world):
        users, place_id, _ = world
        first = _put(client, users["ana"][0], place_id, _png(color=(1, 2, 3))).get_json()["place"]["cover_image_url"]

        second = _put(client, users["ana"][0], place_id, _png(color=(9, 8, 7))).get_json()["place"]["cover_image_url"]

        assert first != second
        assert len(_stored_files()) == 1
        assert client.get("/api/media/" + first[len(MEDIA_PREFIX):]).status_code == 404

    def test_the_response_never_leaks_the_storage_key(self, client, world):
        users, place_id, _ = world
        place = _put(client, users["ana"][0], place_id, _png()).get_json()["place"]
        assert "image_key" not in place and "storage_key" not in place

    def test_each_change_is_audited(self, client, app, world):
        users, place_id, _ = world
        _put(client, users["ana"][0], place_id, _png())
        client.delete(f"/api/places/{place_id}/manage/image", headers=auth(users["ana"][0]))

        with app.app_context():
            rows = db.session.execute(
                text(
                    "SELECT changes->'image' FROM admin_audit_log WHERE resource_id = :r "
                    "AND action = 'place_updated' ORDER BY created_at"
                ),
                {"r": place_id},
            ).scalars().all()
        assert rows == [[False, True], [True, False]]


class TestAccess:
    @pytest.mark.parametrize("who", ["beto", "mod"])
    def test_whoever_does_not_manage_the_place_gets_404_and_nothing_is_stored(self, client, world, who):
        users, place_id, _ = world
        assert _put(client, users[who][0], place_id, _png()).status_code == 404
        assert client.delete(f"/api/places/{place_id}/manage/image", headers=auth(users[who][0])).status_code == 404
        assert _stored_files() == []

    def test_a_manager_of_another_place_cannot_touch_this_one(self, client, world):
        users, _, other_id = world
        assert _put(client, users["ana"][0], other_id, _png()).status_code == 404
        assert _stored_files() == []

    def test_it_requires_a_session(self, client, world):
        _, place_id, _ = world
        response = client.put(
            f"/api/places/{place_id}/manage/image",
            data={"image": (io.BytesIO(_png()), "a.png")},
            content_type="multipart/form-data",
        )
        assert response.status_code == 401

    def test_a_stranger_does_not_spend_cpu_decoding_their_file(self, client, world, monkeypatch):
        users, place_id, _ = world
        called = []
        monkeypatch.setattr(
            "app.interfaces.image_upload.process_attachment", lambda *a, **k: called.append(1)
        )
        assert _put(client, users["beto"][0], place_id, _png()).status_code == 404
        assert called == []


class TestRejections:
    def test_no_file_is_a_400(self, client, world):
        users, place_id, _ = world
        assert _put(client, users["ana"][0], place_id).status_code == 400

    def test_a_json_body_is_a_400(self, client, world):
        users, place_id, _ = world
        response = client.put(
            f"/api/places/{place_id}/manage/image", json={"image": "x"}, headers=auth(users["ana"][0])
        )
        assert response.status_code == 400

    def test_something_that_is_not_an_image_is_a_400_and_stores_nothing(self, client, world):
        users, place_id, _ = world
        response = _put(client, users["ana"][0], place_id, b"%PDF-1.7 " + b"0" * 200, "logo.png")
        assert response.status_code == 400
        assert _stored_files() == []

    def test_an_image_over_5_mb_is_a_413(self, client, world):
        users, place_id, _ = world
        response = _put(client, users["ana"][0], place_id, b"\x89PNG\r\n\x1a\n" + b"0" * (5 * 1024 * 1024))
        assert response.status_code == 413
        assert _stored_files() == []

    def test_a_failure_while_saving_keeps_the_old_image_and_leaves_no_new_file(self, client, world, monkeypatch):
        users, place_id, _ = world
        first = _put(client, users["ana"][0], place_id, _png()).get_json()["place"]["cover_image_url"]

        def boom(self, *args, **kwargs):
            raise RuntimeError("base caída")

        monkeypatch.setattr(
            "app.infrastructure.persistence.repositories.place_repository.SQLAlchemyPlaceRepository.set_image",
            boom,
        )
        response = _put(client, users["ana"][0], place_id, _png(color=(5, 5, 5)))

        assert response.status_code == 500
        assert len(_stored_files()) == 1
        assert client.get("/api/media/" + first[len(MEDIA_PREFIX):]).status_code == 200


class TestRemove:
    def test_the_manager_removes_the_image_and_the_file(self, client, world):
        users, place_id, _ = world
        _put(client, users["ana"][0], place_id, _png())

        response = client.delete(f"/api/places/{place_id}/manage/image", headers=auth(users["ana"][0]))

        assert response.status_code == 200
        assert response.get_json()["place"]["cover_image_url"] is None
        assert _stored_files() == []

    def test_removing_when_there_is_none_is_harmless(self, client, world):
        users, place_id, _ = world
        response = client.delete(f"/api/places/{place_id}/manage/image", headers=auth(users["ana"][0]))
        assert response.status_code == 200 and response.get_json()["place"]["cover_image_url"] is None


class TestImportedPlaces:
    def test_a_claimed_unverified_place_can_have_an_image(self, client, app, world):
        users, _, _ = world
        with app.app_context():
            osm = insert_place("Restaurante OSM", status="unverified", source="osm")
            db.session.execute(
                text("INSERT INTO place_managers (place_id, user_id) VALUES (:p, :u)"),
                {"p": osm, "u": users["ana"][1]},
            )
            db.session.commit()

        assert _put(client, users["ana"][0], osm, _png()).status_code == 200
