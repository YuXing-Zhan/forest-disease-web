from fastapi.testclient import TestClient

from app.main import app


def test_web_origin_can_upload_and_create_case() -> None:
    with TestClient(app) as client:
        response = client.options(
            "/v1/cases",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type,idempotency-key",
            },
        )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_unconfigured_web_origin_is_not_allowed() -> None:
    with TestClient(app) as client:
        response = client.options(
            "/v1/cases",
            headers={
                "Origin": "https://unconfigured.example",
                "Access-Control-Request-Method": "POST",
            },
        )
    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers
