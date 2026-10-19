# Visibilidad del contenido pendiente de revisión (ADR-044 §2.1): lo nuevo no es público, lo
# antiguo no desaparece, y con la moderación apagada nada cambia.

from sqlalchemy import text

from app.extensions import db
from tests.content_moderation.conftest import (
    attachments,
    jobs_table,
    make_account,
    publish_post_with_image,
)
from tests.test_messages import _auth_headers


def _feed_images(client, token):
    posts = client.get("/api/posts", headers=_auth_headers(token)).get_json()["posts"]
    return [image for post in posts for image in post["images"]]


class TestModerationOff:
    def test_nothing_changes_the_shape_or_the_visibility(self, app, client):
        with app.app_context():
            author, _ = make_account(client, "autora")
            other, _ = make_account(client, "lectora")

            post = publish_post_with_image(client, author)

            assert set(post["images"][0]) == {"url", "width", "height"}
            assert post["images"][0]["url"]
            assert _feed_images(client, other)[0]["url"]
            assert [a["moderation_status"] for a in attachments()] == ["approved"]
            assert jobs_table() == []  # sin moderación no se encola nada


class TestModerationOn:
    def test_a_new_image_is_pending_and_a_third_party_does_not_see_it(
        self, app, client, moderation_on
    ):
        with app.app_context():
            author, _ = make_account(client, "autora")
            other, _ = make_account(client, "lectora")

            publish_post_with_image(client, author)

            assert [a["moderation_status"] for a in attachments()] == ["pending"]
            assert _feed_images(client, other) == []

    def test_the_author_sees_it_without_url_and_with_its_status(self, app, client, moderation_on):
        with app.app_context():
            author, _ = make_account(client, "autora")

            created = publish_post_with_image(client, author)["images"][0]
            listed = _feed_images(client, author)[0]

            for image in (created, listed):
                assert image["url"] is None
                assert image["moderation_status"] == "pending"

    def test_the_post_text_stays_visible_only_the_image_is_withheld(
        self, app, client, moderation_on
    ):
        with app.app_context():
            author, _ = make_account(client, "autora")
            other, _ = make_account(client, "lectora")
            publish_post_with_image(client, author, content="hola mundo")

            posts = client.get("/api/posts", headers=_auth_headers(other)).get_json()["posts"]

            assert [p["content"] for p in posts] == ["hola mundo"]
            assert posts[0]["images"] == []

    def test_an_approved_image_becomes_public(self, app, client, moderation_on):
        with app.app_context():
            author, _ = make_account(client, "autora")
            other, _ = make_account(client, "lectora")
            publish_post_with_image(client, author)

            db.session.execute(text("UPDATE media_attachments SET moderation_status = 'approved'"))
            db.session.commit()

            image = _feed_images(client, other)[0]
            assert image["url"] and "moderation_status" not in image

    def test_held_and_rejected_images_stay_hidden(self, app, client, moderation_on):
        with app.app_context():
            author, _ = make_account(client, "autora")
            other, _ = make_account(client, "lectora")
            publish_post_with_image(client, author)
            for state in ("held", "rejected"):
                db.session.execute(
                    text("UPDATE media_attachments SET moderation_status = :s"), {"s": state}
                )
                db.session.commit()
                assert _feed_images(client, other) == []

    def test_a_message_image_is_not_moderated_and_reaches_the_recipient(
        self, app, client, moderation_on
    ):
        """Una conversación privada no la revisa una persona del equipo: la imagen nace aprobada,
        no entra a la cola de moderación y la receptora la ve de inmediato."""
        import io

        from tests.content_moderation.conftest import png

        with app.app_context():
            sender, _ = make_account(client, "emisora")
            recipient, recipient_id = make_account(client, "receptora")
            sent = client.post(
                f"/api/users/{recipient_id}/messages",
                data={"content": "mira", "images": [(io.BytesIO(png()), "f.png")]},
                content_type="multipart/form-data",
                headers=_auth_headers(sender),
            )
            assert sent.status_code == 201
            sender_id = db.session.execute(
                text("SELECT id FROM users WHERE username = 'emisora'")
            ).scalar()

            thread = client.get(
                f"/api/users/{sender_id}/messages", headers=_auth_headers(recipient)
            ).get_json()["messages"]

            assert thread[0]["content"] == "mira" and len(thread[0]["images"]) == 1
            assert db.session.execute(
                text("SELECT count(*) FROM media_attachments WHERE moderation_status <> 'approved'")
            ).scalar() == 0
            assert db.session.execute(
                text("SELECT count(*) FROM moderation_jobs")
            ).scalar() == 0

    def test_the_file_itself_is_not_served_while_not_approved(self, app, client, moderation_on):
        """Autorización efectiva: no basta con ocultar la URL, el archivo responde 404."""
        with app.app_context():
            author, _ = make_account(client, "autora")
            publish_post_with_image(client, author)
            key = attachments()[0]["storage_key"]

            assert client.get(f"/api/media/{key}").status_code == 404

            db.session.execute(text("UPDATE media_attachments SET moderation_status = 'approved'"))
            db.session.commit()
            assert client.get(f"/api/media/{key}").status_code == 200

    def test_files_that_are_not_attachments_are_not_withheld(self, app, client, moderation_on):
        with app.app_context():
            assert client.get("/api/media/avatars/does-not-exist.webp").status_code == 404


class TestFailClosedAndLegacy:
    def test_a_row_inserted_without_a_status_is_pending(self, app, client):
        with app.app_context():
            _, user_id = make_account(client, "autora")
            post_id = db.session.execute(
                text("INSERT INTO posts (author_id, content) VALUES (:u, 'x') RETURNING id"),
                {"u": user_id},
            ).scalar()
            status = db.session.execute(
                text(
                    "INSERT INTO media_attachments (owner_id, post_id, storage_key, width, height) "
                    "VALUES (:u, :p, 'posts/k.webp', 1, 1) RETURNING moderation_status"
                ),
                {"u": user_id, "p": post_id},
            ).scalar()
            db.session.commit()

            assert status == "pending"

    def test_the_database_rejects_an_unknown_status(self, app, client):
        import pytest
        from sqlalchemy.exc import IntegrityError

        with app.app_context():
            _, user_id = make_account(client, "autora")
            post_id = db.session.execute(
                text("INSERT INTO posts (author_id, content) VALUES (:u, 'x') RETURNING id"),
                {"u": user_id},
            ).scalar()
            with pytest.raises(IntegrityError):
                db.session.execute(
                    text(
                        "INSERT INTO media_attachments (owner_id, post_id, storage_key, width, "
                        "height, moderation_status) VALUES (:u, :p, 'posts/z.webp', 1, 1, 'weird')"
                    ),
                    {"u": user_id, "p": post_id},
                )
            db.session.rollback()
