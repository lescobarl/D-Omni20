"""Tests de los endpoints de keywords con prioridades del bot (Fase 3).

Cubre ``/api/v1/bot/keywords``:

- CRUD individual: crear (201, recorte de espacios), duplicado case-insensitive
  (422 ``validation.input_error``), prioridad fuera de rango (422
  ``validation.request_error``), actualizar (200/404/conflicto excluyendo el
  propio registro), soft-delete (204/404).
- Listado paginado ordenado por prioridad (menor número = mayor prioridad).
- Habilitar/deshabilitar una keyword vía actualización parcial.
- Aislamiento multi-tenant: cabecera ausente (403) y tenant aislado que nunca
  ve, lista ni modifica datos de ``dev-tenant``.

Notas de diseño:
- El tenant ``dev-tenant`` del conftest es de scope sesión y acumula filas entre
  tests, por lo que cada test usa términos únicos (sufijo UUID) para ser
  determinista e independiente del orden de ejecución.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient

TENANT_HEADERS: dict[str, str] = {"X-Tenant-Id": "dev-tenant"}

# Cabeceras de autenticación por defecto (RBAC). El super-admin omite la
# comprobación de membresía, por lo que vale tanto para el tenant de desarrollo
# como para tenants UUID frescos.
_AUTH: dict[str, str] = {}


@pytest.fixture(autouse=True)
def _auth_headers(super_admin_token: str) -> None:
    """Añade el Bearer del super-admin a las cabeceras por defecto (RBAC)."""
    _AUTH["Authorization"] = f"Bearer {super_admin_token}"
    TENANT_HEADERS["Authorization"] = f"Bearer {super_admin_token}"


def _other_tenant() -> dict[str, str]:
    """Cabeceras de un tenant aislado (UUID aleatorio válido, no sembrado)."""
    return {"X-Tenant-Id": str(uuid.uuid4()), **_AUTH}


def _unique_term(prefix: str) -> str:
    """Término único por test (el tenant dev comparte base entre tests)."""
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


def _create_keyword(
    client: TestClient,
    *,
    term: str | None = None,
    response: str = "Respuesta fija del bot",
    priority: int = 100,
    enabled: bool = True,
    headers: dict[str, str] = TENANT_HEADERS,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "term": term if term is not None else _unique_term("keyword"),
        "response": response,
        "priority": priority,
        "enabled": enabled,
    }
    response = client.post("/api/v1/bot/keywords", json=payload, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


# ---------------------------------------------------------------------------
# CRUD individual
# ---------------------------------------------------------------------------


def test_create_keyword_returns_201(client: TestClient, tenant_id: uuid.UUID) -> None:
    """Crear una keyword devuelve el registro con su tupla sync."""
    body = _create_keyword(client, term="Garantía", response="Te explico la garantía", priority=10)
    assert body["term"] == "Garantía"
    assert body["response"] == "Te explico la garantía"
    assert body["priority"] == 10
    assert body["enabled"] is True
    assert body["tenant_id"] == str(tenant_id)
    assert body["version"] == 1
    assert body["revision"] == 1
    assert body["id"]


def test_create_keyword_strips_whitespace(client: TestClient) -> None:
    """Los espacios alrededor del término se recortan al crear."""
    body = _create_keyword(client, term="  Hola  ", response="Hola mundo")
    assert body["term"] == "Hola"
    assert body["response"] == "Hola mundo"


def test_create_duplicate_term_returns_422(client: TestClient) -> None:
    """Un término ya existente (comparado case-insensitive) se rechaza."""
    term = _unique_term("duplicado")
    _create_keyword(client, term=term)
    response = client.post(
        "/api/v1/bot/keywords",
        json={"term": term.upper(), "response": "otra"},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "validation.input_error"
    assert body["error"]["operation"] == "keywords.create"


def test_create_priority_out_of_range_returns_422(client: TestClient) -> None:
    """La prioridad es un entero en [0, 1000]; fuera de rango se rechaza."""
    over = client.post(
        "/api/v1/bot/keywords",
        json={"term": _unique_term("prioridad"), "response": "x", "priority": 1001},
        headers=TENANT_HEADERS,
    )
    assert over.status_code == 422
    assert over.json()["error"]["code"] == "validation.request_error"

    under = client.post(
        "/api/v1/bot/keywords",
        json={"term": _unique_term("prioridad"), "response": "x", "priority": -1},
        headers=TENANT_HEADERS,
    )
    assert under.status_code == 422
    assert under.json()["error"]["code"] == "validation.request_error"


def test_list_keywords_returns_page(client: TestClient) -> None:
    """Lista paginada: incluye la keyword recién creada."""
    created = _create_keyword(client)

    response = client.get("/api/v1/bot/keywords", headers=TENANT_HEADERS)
    assert response.status_code == 200
    body = response.json()
    assert "items" in body and "total" in body
    assert body["page"] == 1 and body["page_size"] == 20
    assert body["total"] >= 1
    assert any(item["id"] == created["id"] for item in body["items"])


def test_list_keywords_ordered_by_priority(client: TestClient) -> None:
    """El listado ordena por prioridad asc (menor número primero)."""
    alta = _create_keyword(client, term=_unique_term("alta"), priority=10)
    baja = _create_keyword(client, term=_unique_term("baja"), priority=90)

    body = client.get("/api/v1/bot/keywords", headers=TENANT_HEADERS).json()
    ids = [item["id"] for item in body["items"]]
    assert ids.index(alta["id"]) < ids.index(baja["id"])


def test_update_keyword_returns_200(client: TestClient) -> None:
    """Actualizar respuesta, prioridad y estado del propio registro."""
    created = _create_keyword(client, term=_unique_term("editar"), response="Original", priority=100)

    response = client.put(
        f"/api/v1/bot/keywords/{created['id']}",
        json={"response": "Actualizada", "priority": 5, "enabled": False},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["response"] == "Actualizada"
    assert body["priority"] == 5
    assert body["enabled"] is False
    assert body["term"] == created["term"]  # no enviado → no cambia.


def test_update_keyword_missing_returns_404(client: TestClient) -> None:
    """Actualizar una keyword inexistente devuelve 404."""
    response = client.put(
        f"/api/v1/bot/keywords/{uuid.uuid4()}",
        json={"response": "Nueva"},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 404
    assert response.json()["error"]["operation"] == "keywords.update"


def test_update_term_conflict_excluding_self(client: TestClient) -> None:
    """Conflicto con otro término → 422; mantener el propio término → 200."""
    term_a = _unique_term("conflicto")
    first = _create_keyword(client, term=term_a)
    second = _create_keyword(client)

    # Renombrar `second` a `term_a` choca con `first`.
    conflict = client.put(
        f"/api/v1/bot/keywords/{second['id']}",
        json={"term": term_a},
        headers=TENANT_HEADERS,
    )
    assert conflict.status_code == 422
    assert conflict.json()["error"]["operation"] == "keywords.update"

    # Reescribir el propio término no se considera conflicto.
    ok = client.put(
        f"/api/v1/bot/keywords/{first['id']}",
        json={"term": term_a, "response": "nueva respuesta"},
        headers=TENANT_HEADERS,
    )
    assert ok.status_code == 200
    assert ok.json()["response"] == "nueva respuesta"


def test_update_keyword_enable_disable(client: TestClient) -> None:
    """Habilitar/deshabilitar una keyword vía actualización parcial."""
    created = _create_keyword(client, term=_unique_term("toggle"))

    disabled = client.put(
        f"/api/v1/bot/keywords/{created['id']}",
        json={"enabled": False},
        headers=TENANT_HEADERS,
    )
    assert disabled.status_code == 200
    assert disabled.json()["enabled"] is False

    reenabled = client.put(
        f"/api/v1/bot/keywords/{created['id']}",
        json={"enabled": True},
        headers=TENANT_HEADERS,
    )
    assert reenabled.status_code == 200
    assert reenabled.json()["enabled"] is True


def test_delete_keyword_returns_204(client: TestClient) -> None:
    """Soft-delete devuelve 204 y la keyword deja de listarse."""
    created = _create_keyword(client)
    response = client.delete(
        f"/api/v1/bot/keywords/{created['id']}", headers=TENANT_HEADERS
    )
    assert response.status_code == 204

    listed = client.get("/api/v1/bot/keywords", headers=TENANT_HEADERS).json()
    assert all(item["id"] != created["id"] for item in listed["items"])


def test_delete_keyword_missing_returns_404(client: TestClient) -> None:
    """Borrar una keyword inexistente devuelve 404."""
    response = client.delete(
        f"/api/v1/bot/keywords/{uuid.uuid4()}", headers=TENANT_HEADERS
    )
    assert response.status_code == 404
    assert response.json()["error"]["operation"] == "keywords.delete"


# ---------------------------------------------------------------------------
# Aislamiento multi-tenant
# ---------------------------------------------------------------------------


def test_keywords_missing_tenant_header_returns_403(
    client: TestClient, super_admin_token: str
) -> None:
    """Sin cabecera X-Tenant-Id se deniega la operación (aislamiento)."""
    response = client.post(
        "/api/v1/bot/keywords",
        json={"term": "Privado", "response": "x"},
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "tenant.isolation_violation"


def test_keywords_cross_tenant_isolation(client: TestClient) -> None:
    """Un tenant aislado no ve, lista ni modifica las keywords de dev-tenant."""
    created = _create_keyword(client, term=_unique_term("aislado"))

    listed = client.get("/api/v1/bot/keywords", headers=_other_tenant())
    assert listed.status_code == 200
    listed_body = listed.json()
    assert listed_body["total"] == 0
    assert listed_body["items"] == []

    updated = client.put(
        f"/api/v1/bot/keywords/{created['id']}",
        json={"response": "Hackeada"},
        headers=_other_tenant(),
    )
    assert updated.status_code == 404
    assert updated.json()["error"]["operation"] == "keywords.update"

    deleted = client.delete(
        f"/api/v1/bot/keywords/{created['id']}", headers=_other_tenant()
    )
    assert deleted.status_code == 404
    assert deleted.json()["error"]["operation"] == "keywords.delete"
