# Cabeceras de seguridad de la API y GET /api/health.

from app import create_app


def _client():
    return create_app().test_client()


class TestSecurityHeaders:
    def test_every_response_carries_the_base_headers(self):
        response = _client().get("/api/health")

        assert response.headers["X-Content-Type-Options"] == "nosniff"
        assert response.headers["X-Frame-Options"] == "DENY"
        assert response.headers["Referrer-Policy"] == "no-referrer"
        assert "frame-ancestors 'none'" in response.headers["Content-Security-Policy"]

    def test_error_responses_carry_them_too(self):
        response = _client().get("/api/ruta-que-no-existe")

        assert response.status_code == 404
        assert response.headers["X-Content-Type-Options"] == "nosniff"

    def test_no_hsts_over_plain_http(self):
        response = _client().get("/api/health")

        assert "Strict-Transport-Security" not in response.headers

    def test_hsts_when_the_proxy_reports_https(self):
        response = _client().get("/api/health", headers={"X-Forwarded-Proto": "https"})

        assert "max-age=31536000" in response.headers["Strict-Transport-Security"]

    def test_does_not_overwrite_a_header_a_route_already_set(self):
        app = create_app()

        @app.route("/_probe")
        def _probe():
            from flask import make_response
            r = make_response("x")
            r.headers["X-Frame-Options"] = "SAMEORIGIN"
            return r

        assert app.test_client().get("/_probe").headers["X-Frame-Options"] == "SAMEORIGIN"


class TestHealth:
    def test_ok_when_the_database_answers(self):
        response = _client().get("/api/health")

        assert response.status_code == 200
        assert response.get_json() == {"status": "ok"}
        assert response.headers["Cache-Control"] == "no-store"

    def test_503_without_leaking_details_when_the_database_fails(self, monkeypatch):
        from app.extensions import db

        def _boom(*args, **kwargs):
            raise RuntimeError("password=secreto host=interno")

        monkeypatch.setattr(db.session, "execute", _boom)

        response = _client().get("/api/health")

        assert response.status_code == 503
        assert response.get_json() == {"status": "degraded"}
        assert b"secreto" not in response.data
