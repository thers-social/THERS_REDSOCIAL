# Lugares mejor valorados: GET /api/places/top (ADR-053), contra PostgreSQL real.

from tests.places.helpers import auth, insert_place, make_users
from app.extensions import db


def _top(client, query=""):
    return client.get(f"/api/places/top{query}")


def _review(client, token, place_id, rating):
    return client.put(f"/api/places/{place_id}/review", json={"rating": rating}, headers=auth(token))


def test_top_orders_by_rating_then_reviews_and_puts_unrated_last(app, client):
    users = make_users(app, client)
    with app.app_context():
        unrated = insert_place("Zeta sin reseñas")
        good = insert_place("Buen lugar")
        great = insert_place("Gran lugar")
    _review(client, users["ana"][0], good, 4)
    _review(client, users["ana"][0], great, 5)
    _review(client, users["beto"][0], great, 5)

    names = [p["name"] for p in _top(client).get_json()["places"]]

    assert names[:3] == ["Gran lugar", "Buen lugar", "Zeta sin reseñas"]
    assert unrated  # el sin reseñas sigue siendo público, solo va al final


def test_top_filters_by_category_hides_non_public_and_respects_limit(app, client):
    with app.app_context():
        insert_place("Café Uno", category="cafes")
        insert_place("Café Dos", category="cafes")
        insert_place("Café Oculto", category="cafes", status="rejected")
        insert_place("Farmacia Sol", category="farmacias")

    cafes = _top(client, "?category=cafes").get_json()["places"]
    assert sorted(p["name"] for p in cafes) == ["Café Dos", "Café Uno"]
    assert len(_top(client, "?category=cafes&limit=1").get_json()["places"]) == 1
    assert _top(client, "?category=no-existe").status_code == 400
    assert _top(client, "?limit=x").status_code == 400
    # Sin ubicación de nadie en la respuesta.
    assert not {"distance_meters"} & set(cafes[0])
