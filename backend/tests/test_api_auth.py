"""Tests de los endpoints de OAuth de Google Calendar (autorización y callback).

Usa el ``client`` de sesión compartido; no requieren tenant porque los
endpoints de auth (como los de health) no exigen cabecera ``X-Tenant-Id``.
Con las credenciales vacías de ``test_settings``, la autorización devuelve 501.
"""

from fastapi.testclient import TestClient


def test_google_authorize_unconfigured_returns_501(client: TestClient) -> None:
    response = client.get("/api/v1/auth/google/authorize")

    assert response.status_code == 501
    assert "Google Calendar" in response.json()["detail"]


def test_google_callback_missing_code_returns_422(client: TestClient) -> None:
    response = client.get("/api/v1/auth/google/callback")

    assert response.status_code == 422
