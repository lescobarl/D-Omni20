"""Tests del subsistema CRM (pipeline, tareas, SLA, embudo y resumen).

Cubre el caso de uso comercial end-to-end sobre ``/api/v1/crm``:
- Etapas (``/stages``): CRUD, nombre único por tenant, invariante de resultado
  (una etapa terminal DEBE declarar ``outcome`` won/lost; una no terminal NO
  puede llevarlo) y guarda de eliminación cuando hay oportunidades asociadas.
- Oportunidades (``/deals``): CRUD, aislamiento multi-tenant, validación de
  payload (422), movimientos entre etapas con cierre ganado/perdido, historial
  ``StageChangeRead`` y reapertura que limpia las marcas de cierre.
- Tareas (``/tasks``): CRUD, vínculo ``deal_id`` vía ``/deals/{id}/tasks``,
  ``completed_at`` automático al marcarse ``done`` y limpieza al reabrir.
- SLA (``/sla``): upsert por etapa (crea o actualiza en sitio conservando id),
  revisiones de la tupla sync y listado.
- Embudo (``/funnel``): agregación por etapa con conversión y tasas de cierre.
- Resumen (``/summary``): oportunidades/tareas de un contacto por email.

Reglas CLAUDE validadas: tupla sync ``[revision, updated_at, deleted]``
(revision 1 al crear, 2 tras cualquier PATCH), soft-delete siempre, repositorios
ABC inyectados vía ``Depends``, errores con contexto
(``error.code``/``error.operation``/``error.message``) y aislamiento por tenant.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.repositories.sqlalchemy_repositories import SqlAlchemyContactRepository

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


def _fresh_tenant() -> dict[str, str]:
    """Cabeceras de un tenant UUID fresco (aisla el test de datos de desarrollo)."""
    return {"X-Tenant-Id": str(uuid.uuid4()), **_AUTH}


# ────────────────────────────────────────────────────────────────────────────
# Helpers de payload
# ────────────────────────────────────────────────────────────────────────────


def _stage_payload(**overrides: Any) -> dict[str, Any]:
    """Payload válido de etapa con nombre único (evita colisiones por tenant)."""
    payload: dict[str, Any] = {
        "name": f"Etapa {uuid.uuid4().hex[:8]}",
        "order": 0,
        "default_probability": 10,
        "is_terminal": False,
        "outcome": None,
    }
    payload.update(overrides)
    return payload


def _deal_payload(stage_id: uuid.UUID, **overrides: Any) -> dict[str, Any]:
    """Payload válido de oportunidad anclado a una etapa existente."""
    payload: dict[str, Any] = {
        "title": f"Deal {uuid.uuid4().hex[:8]}",
        "stage_id": str(stage_id),
        "amount_minor": 0,
        "currency": "USD",
        "probability": 0,
    }
    payload.update(overrides)
    return payload


def _task_payload(**overrides: Any) -> dict[str, Any]:
    """Payload válido de tarea con título único."""
    payload: dict[str, Any] = {
        "title": f"Tarea {uuid.uuid4().hex[:8]}",
        "status": "pending",
        "priority": "medium",
    }
    payload.update(overrides)
    return payload


def _sla_payload(stage_id: uuid.UUID, **overrides: Any) -> dict[str, Any]:
    """Payload válido de política SLA para una etapa."""
    payload: dict[str, Any] = {
        "stage_id": str(stage_id),
        "max_response_hours": 24,
        "max_stay_days": 7,
    }
    payload.update(overrides)
    return payload


# ────────────────────────────────────────────────────────────────────────────
# Helpers de creación (201 esperado)
# ────────────────────────────────────────────────────────────────────────────


def _create_stage(
    client: TestClient,
    headers: dict[str, str] | None = None,
    **overrides: Any,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Crea una etapa y devuelve ``(payload, body)`` — 201 esperado."""
    headers = headers or TENANT_HEADERS
    payload = _stage_payload(**overrides)
    response = client.post("/api/v1/crm/stages", json=payload, headers=headers)
    assert response.status_code == 201, response.text
    return payload, response.json()


def _create_deal(
    client: TestClient,
    stage_id: uuid.UUID,
    headers: dict[str, str] | None = None,
    **overrides: Any,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Crea una oportunidad en ``stage_id`` y devuelve ``(payload, body)``."""
    headers = headers or TENANT_HEADERS
    payload = _deal_payload(stage_id, **overrides)
    response = client.post("/api/v1/crm/deals", json=payload, headers=headers)
    assert response.status_code == 201, response.text
    return payload, response.json()


def _create_task(
    client: TestClient,
    headers: dict[str, str] | None = None,
    **overrides: Any,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Crea una tarea y devuelve ``(payload, body)`` — 201 esperado."""
    headers = headers or TENANT_HEADERS
    payload = _task_payload(**overrides)
    response = client.post("/api/v1/crm/tasks", json=payload, headers=headers)
    assert response.status_code == 201, response.text
    return payload, response.json()


# ────────────────────────────────────────────────────────────────────────────
# Etapas (/api/v1/crm/stages)
# ────────────────────────────────────────────────────────────────────────────


def test_create_stage_returns_201(client: TestClient) -> None:
    """Crea una etapa y devuelve la tupla sync inicial (revision == 1)."""
    payload, body = _create_stage(client)
    assert body["name"] == payload["name"]
    assert body["order"] == payload["order"]
    assert body["default_probability"] == payload["default_probability"]
    assert body["is_terminal"] is False
    assert body["outcome"] is None
    assert body["revision"] == 1
    assert body["id"]
    assert body["tenant_id"]


def test_create_terminal_stage_with_outcome_returns_201(client: TestClient) -> None:
    """Una etapa terminal con resultado declarado se crea sin problemas."""
    _, body = _create_stage(client, is_terminal=True, outcome="won")
    assert body["is_terminal"] is True
    assert body["outcome"] == "won"
    assert body["revision"] == 1


def test_create_terminal_stage_without_outcome_returns_422(client: TestClient) -> None:
    """Invariante: una etapa terminal debe declarar su resultado."""
    payload = _stage_payload(is_terminal=True, outcome=None)
    response = client.post("/api/v1/crm/stages", json=payload, headers=TENANT_HEADERS)
    assert response.status_code == 422, response.text
    body = response.json()
    assert body["error"]["code"] == "validation.input_error"
    assert body["error"]["operation"] == "crm.stage.create"
    assert "Una etapa terminal debe declarar su resultado" in body["error"]["message"]


def test_create_non_terminal_stage_with_outcome_returns_422(client: TestClient) -> None:
    """Invariante: una etapa no terminal no puede llevar resultado de cierre."""
    payload = _stage_payload(is_terminal=False, outcome="won")
    response = client.post("/api/v1/crm/stages", json=payload, headers=TENANT_HEADERS)
    assert response.status_code == 422, response.text
    body = response.json()
    assert body["error"]["code"] == "validation.input_error"
    assert body["error"]["operation"] == "crm.stage.create"
    assert "Una etapa no terminal no puede llevar resultado de cierre" in body["error"]["message"]


def test_create_duplicate_stage_name_returns_409(client: TestClient) -> None:
    """El nombre de etapa es único por tenant (conflicto 409)."""
    payload, _ = _create_stage(client)
    response = client.post("/api/v1/crm/stages", json=payload, headers=TENANT_HEADERS)
    assert response.status_code == 409, response.text
    body = response.json()
    assert body["error"]["code"] == "resource.conflict"
    assert body["error"]["operation"] == "crm.stage.create"
    assert "Ya existe una etapa con este nombre" in body["error"]["message"]


def test_same_stage_name_allowed_in_other_tenant(client: TestClient) -> None:
    """El nombre único es por tenant: otro tenant puede reutilizarlo."""
    payload, _ = _create_stage(client, TENANT_HEADERS)
    response = client.post(
        "/api/v1/crm/stages", json=payload, headers=_fresh_tenant()
    )
    assert response.status_code == 201, response.text


def test_list_stages_returns_created(client: TestClient) -> None:
    """Lista las etapas del tenant, incluyendo la recién creada."""
    headers = _fresh_tenant()
    _, first = _create_stage(client, headers)
    _, second = _create_stage(client, headers)
    response = client.get("/api/v1/crm/stages", headers=headers)
    assert response.status_code == 200, response.text
    ids = [stage["id"] for stage in response.json()]
    assert first["id"] in ids
    assert second["id"] in ids


def test_get_stage_roundtrip(client: TestClient) -> None:
    """Obtener una etapa devuelve exactamente lo creado."""
    _, created = _create_stage(client, TENANT_HEADERS)
    response = client.get(f"/api/v1/crm/stages/{created['id']}", headers=TENANT_HEADERS)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["id"] == created["id"]
    assert body["name"] == created["name"]
    assert body["revision"] == 1


def test_get_missing_stage_returns_404(client: TestClient) -> None:
    """Etapa inexistente → 404 con contexto ``crm.stage.get``."""
    response = client.get(
        f"/api/v1/crm/stages/{uuid.uuid4()}", headers=TENANT_HEADERS
    )
    assert response.status_code == 404, response.text
    body = response.json()
    assert body["error"]["code"] == "resource.not_found"
    assert body["error"]["operation"] == "crm.stage.get"
    assert "Etapa no encontrada" in body["error"]["message"]


def test_update_stage_patches_and_bumps_revision(client: TestClient) -> None:
    """PATCH sobre la etapa actualiza y sube la revisión a 2."""
    _, created = _create_stage(client, TENANT_HEADERS)
    response = client.patch(
        f"/api/v1/crm/stages/{created['id']}",
        json={"name": f"Renombrada {uuid.uuid4().hex[:8]}", "order": 5},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["id"] == created["id"]
    assert body["order"] == 5
    assert body["revision"] == 2


def test_update_stage_empty_patch_returns_422(client: TestClient) -> None:
    """PATCH vacío → 422 (fail-fast, sin cambios en la tupla sync)."""
    _, created = _create_stage(client, TENANT_HEADERS)
    response = client.patch(
        f"/api/v1/crm/stages/{created['id']}", json={}, headers=TENANT_HEADERS
    )
    assert response.status_code == 422, response.text
    body = response.json()
    assert body["error"]["code"] == "validation.input_error"
    assert body["error"]["operation"] == "crm.stage.update"
    assert "No se recibieron campos para actualizar" in body["error"]["message"]


def test_update_stage_duplicate_name_returns_409(client: TestClient) -> None:
    """Renombrar a un nombre ya usado por otra etapa → 409."""
    _, first = _create_stage(client, TENANT_HEADERS)
    _, second = _create_stage(client, TENANT_HEADERS)
    response = client.patch(
        f"/api/v1/crm/stages/{second['id']}",
        json={"name": first["name"]},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 409, response.text
    body = response.json()
    assert body["error"]["code"] == "resource.conflict"
    assert body["error"]["operation"] == "crm.stage.update"


def test_update_stage_to_terminal_without_outcome_returns_422(client: TestClient) -> None:
    """Convertir a terminal sin declarar resultado viola el invariante."""
    _, created = _create_stage(client, TENANT_HEADERS)
    response = client.patch(
        f"/api/v1/crm/stages/{created['id']}",
        json={"is_terminal": True},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 422, response.text
    body = response.json()
    assert body["error"]["code"] == "validation.input_error"
    assert body["error"]["operation"] == "crm.stage.update"
    assert "Una etapa terminal debe declarar su resultado" in body["error"]["message"]


def test_update_stage_terminal_to_non_terminal_normalizes_outcome(
    client: TestClient,
) -> None:
    """Terminal → no terminal requiere limpiar el outcome (se normaliza a None)."""
    _, created = _create_stage(client, TENANT_HEADERS, is_terminal=True, outcome="won")
    response = client.patch(
        f"/api/v1/crm/stages/{created['id']}",
        json={"is_terminal": False, "outcome": None},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["is_terminal"] is False
    assert body["outcome"] is None
    assert body["revision"] == 2


def test_update_stage_terminal_to_non_terminal_without_outcome_returns_422(
    client: TestClient,
) -> None:
    """Bajar de terminal sin limpiar el outcome viola el invariante (valores mezclados)."""
    _, created = _create_stage(client, TENANT_HEADERS, is_terminal=True, outcome="won")
    response = client.patch(
        f"/api/v1/crm/stages/{created['id']}",
        json={"is_terminal": False},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 422, response.text
    body = response.json()
    assert body["error"]["code"] == "validation.input_error"
    assert body["error"]["operation"] == "crm.stage.update"
    assert "Una etapa no terminal no puede llevar resultado de cierre" in body["error"]["message"]


def test_delete_stage_returns_204(client: TestClient) -> None:
    """Soft-delete de una etapa sin oportunidades → 204 y luego 404."""
    _, created = _create_stage(client, TENANT_HEADERS)
    response = client.delete(
        f"/api/v1/crm/stages/{created['id']}", headers=TENANT_HEADERS
    )
    assert response.status_code == 204, response.text
    gone = client.get(
        f"/api/v1/crm/stages/{created['id']}", headers=TENANT_HEADERS
    )
    assert gone.status_code == 404


def test_delete_stage_with_deals_returns_409(client: TestClient) -> None:
    """No se puede eliminar una etapa con oportunidades asociadas (guard)."""
    headers = _fresh_tenant()
    _, stage = _create_stage(client, headers)
    _create_deal(client, uuid.UUID(stage["id"]), headers=headers)
    response = client.delete(f"/api/v1/crm/stages/{stage['id']}", headers=headers)
    assert response.status_code == 409, response.text
    body = response.json()
    assert body["error"]["code"] == "resource.conflict"
    assert body["error"]["operation"] == "crm.stage.delete"
    assert "No se puede eliminar una etapa con oportunidades asociadas" in body["error"]["message"]
    still = client.get(f"/api/v1/crm/stages/{stage['id']}", headers=headers)
    assert still.status_code == 200


def test_delete_missing_stage_returns_404(client: TestClient) -> None:
    """Eliminar una etapa inexistente → 404 ``crm.stage.delete``."""
    response = client.delete(
        f"/api/v1/crm/stages/{uuid.uuid4()}", headers=TENANT_HEADERS
    )
    assert response.status_code == 404, response.text
    body = response.json()
    assert body["error"]["code"] == "resource.not_found"
    assert body["error"]["operation"] == "crm.stage.delete"


# ────────────────────────────────────────────────────────────────────────────
# Oportunidades (/api/v1/crm/deals)
# ────────────────────────────────────────────────────────────────────────────


def test_create_deal_returns_201(client: TestClient) -> None:
    """Crea una oportunidad abierta con tupla sync inicial (revision == 1)."""
    _, stage = _create_stage(client, TENANT_HEADERS)
    payload, body = _create_deal(client, uuid.UUID(stage["id"]))
    assert body["title"] == payload["title"]
    assert body["stage_id"] == stage["id"]
    assert body["amount_minor"] == 0
    assert body["currency"] == "USD"
    assert body["status"] == "open"
    assert body["revision"] == 1
    assert body["id"]
    assert body["contact_id"] is None


def test_create_deal_missing_tenant_header_returns_403(
    client: TestClient, super_admin_token: str
) -> None:
    """Sin cabecera de tenant → 403 ``tenant.isolation_violation``."""
    _, stage = _create_stage(client, TENANT_HEADERS)
    response = client.post(
        "/api/v1/crm/deals",
        json=_deal_payload(uuid.UUID(stage["id"])),
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    assert response.status_code == 403, response.text
    body = response.json()
    assert body["error"]["code"] == "tenant.isolation_violation"
    assert body["error"]["operation"] == "tenant.resolve"


def test_create_deal_invalid_payload_returns_422(client: TestClient) -> None:
    """Payload con probabilidad fuera de rango → 422 de validación de request."""
    _, stage = _create_stage(client, TENANT_HEADERS)
    response = client.post(
        "/api/v1/crm/deals",
        json=_deal_payload(uuid.UUID(stage["id"]), probability=101),
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 422, response.text
    body = response.json()
    assert body["error"]["code"] == "validation.request_error"


def test_create_deal_unknown_stage_returns_404(client: TestClient) -> None:
    """Crear una oportunidad en una etapa inexistente → 404 ``crm.deal.create``."""
    response = client.post(
        "/api/v1/crm/deals",
        json=_deal_payload(uuid.uuid4()),
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 404, response.text
    body = response.json()
    assert body["error"]["code"] == "resource.not_found"
    assert body["error"]["operation"] == "crm.deal.create"
    assert "Etapa no encontrada" in body["error"]["message"]


def test_create_deal_in_terminal_stage_returns_422(client: TestClient) -> None:
    """No se puede abrir una oportunidad directamente en una etapa terminal."""
    _, terminal = _create_stage(client, TENANT_HEADERS, is_terminal=True, outcome="won")
    response = client.post(
        "/api/v1/crm/deals",
        json=_deal_payload(uuid.UUID(terminal["id"])),
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 422, response.text
    body = response.json()
    assert body["error"]["code"] == "validation.input_error"
    assert body["error"]["operation"] == "crm.deal.create"
    assert "No se puede crear una oportunidad en una etapa terminal" in body["error"]["message"]


def test_list_deals_returns_page_and_filters(client: TestClient) -> None:
    """Lista paginada con filtros por etapa, estado y propietario."""
    headers = _fresh_tenant()
    _, stage_a = _create_stage(client, headers, order=0)
    _, stage_b = _create_stage(client, headers, order=1)
    owner = uuid.uuid4()
    _create_deal(client, uuid.UUID(stage_a["id"]), headers=headers)
    _create_deal(client, uuid.UUID(stage_a["id"]), headers=headers)
    _create_deal(client, uuid.UUID(stage_b["id"]), headers=headers, owner_id=str(owner))

    response = client.get("/api/v1/crm/deals", headers=headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 3
    assert body["page"] == 1
    assert body["page_size"] == 20
    assert len(body["items"]) == 3

    by_stage = client.get(
        f"/api/v1/crm/deals?stage_id={stage_a['id']}", headers=headers
    )
    assert by_stage.json()["total"] == 2

    by_status = client.get("/api/v1/crm/deals?status=open", headers=headers)
    assert by_status.json()["total"] == 3

    by_owner = client.get(f"/api/v1/crm/deals?owner_id={owner}", headers=headers)
    assert by_owner.json()["total"] == 1


def test_get_deal_roundtrip(client: TestClient) -> None:
    """Obtener una oportunidad devuelve exactamente lo creado."""
    headers = _fresh_tenant()
    _, stage = _create_stage(client, headers)
    _, created = _create_deal(client, uuid.UUID(stage["id"]), headers=headers)
    response = client.get(f"/api/v1/crm/deals/{created['id']}", headers=headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["id"] == created["id"]
    assert body["title"] == created["title"]
    assert body["metadata"] == {}


def test_get_missing_deal_returns_404(client: TestClient) -> None:
    """Oportunidad inexistente → 404 ``crm.deal.get``."""
    response = client.get(f"/api/v1/crm/deals/{uuid.uuid4()}", headers=TENANT_HEADERS)
    assert response.status_code == 404, response.text
    body = response.json()
    assert body["error"]["code"] == "resource.not_found"
    assert body["error"]["operation"] == "crm.deal.get"
    assert "Oportunidad no encontrada" in body["error"]["message"]


def test_update_deal_patches_and_bumps_revision(client: TestClient) -> None:
    """PATCH de título actualiza y sube la revisión a 2 (mantiene la etapa)."""
    headers = _fresh_tenant()
    _, stage = _create_stage(client, headers)
    _, created = _create_deal(client, uuid.UUID(stage["id"]), headers=headers)
    new_title = f"Renombrado {uuid.uuid4().hex[:8]}"
    response = client.patch(
        f"/api/v1/crm/deals/{created['id']}",
        json={"title": new_title},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["id"] == created["id"]
    assert body["title"] == new_title
    assert body["stage_id"] == stage["id"]
    assert body["revision"] == 2


def test_update_deal_empty_patch_returns_422(client: TestClient) -> None:
    """PATCH vacío → 422 (fail-fast, sin tocar la tupla sync)."""
    headers = _fresh_tenant()
    _, stage = _create_stage(client, headers)
    _, created = _create_deal(client, uuid.UUID(stage["id"]), headers=headers)
    response = client.patch(
        f"/api/v1/crm/deals/{created['id']}", json={}, headers=headers
    )
    assert response.status_code == 422, response.text
    body = response.json()
    assert body["error"]["code"] == "validation.input_error"
    assert body["error"]["operation"] == "crm.deal.update"


def test_update_deal_move_to_unknown_stage_returns_404(client: TestClient) -> None:
    """Mover a una etapa inexistente → 404 ``crm.deal.update``."""
    headers = _fresh_tenant()
    _, stage = _create_stage(client, headers)
    _, created = _create_deal(client, uuid.UUID(stage["id"]), headers=headers)
    response = client.patch(
        f"/api/v1/crm/deals/{created['id']}",
        json={"stage_id": str(uuid.uuid4())},
        headers=headers,
    )
    assert response.status_code == 404, response.text
    body = response.json()
    assert body["error"]["code"] == "resource.not_found"
    assert body["error"]["operation"] == "crm.deal.update"
    assert "Etapa destino no encontrada" in body["error"]["message"]


def test_update_deal_move_to_won_terminal(client: TestClient) -> None:
    """Mover a una etapa terminal con outcome 'won' cierra como GANADA."""
    headers = _fresh_tenant()
    _, open_stage = _create_stage(client, headers, order=0)
    _, won_stage = _create_stage(client, headers, order=1, is_terminal=True, outcome="won")
    _, created = _create_deal(client, uuid.UUID(open_stage["id"]), headers=headers)

    response = client.patch(
        f"/api/v1/crm/deals/{created['id']}",
        json={"stage_id": won_stage["id"]},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "won"
    assert body["stage_id"] == won_stage["id"]
    assert body["won_at"] is not None
    assert body["closed_at"] is not None
    assert body["lost_at"] is None
    assert body["lost_reason"] is None
    assert body["revision"] == 2

    history = client.get(
        f"/api/v1/crm/deals/{created['id']}/history", headers=headers
    )
    assert history.status_code == 200, history.text
    changes = history.json()
    assert len(changes) == 2
    assert [c["changed_by"] for c in changes] == ["sistema", "vendedor"]
    assert changes[0]["from_stage_id"] is None
    assert changes[0]["to_stage_id"] == open_stage["id"]
    assert changes[1]["from_stage_id"] == open_stage["id"]
    assert changes[1]["to_stage_id"] == won_stage["id"]


def test_update_deal_move_to_lost_terminal_requires_lost_reason(
    client: TestClient,
) -> None:
    """Mover a terminal con outcome 'lost' exige un motivo (fail-fast)."""
    headers = _fresh_tenant()
    _, open_stage = _create_stage(client, headers, order=0)
    _, lost_stage = _create_stage(client, headers, order=1, is_terminal=True, outcome="lost")
    _, created = _create_deal(client, uuid.UUID(open_stage["id"]), headers=headers)

    response = client.patch(
        f"/api/v1/crm/deals/{created['id']}",
        json={"stage_id": lost_stage["id"]},
        headers=headers,
    )
    assert response.status_code == 422, response.text
    body = response.json()
    assert body["error"]["code"] == "validation.input_error"
    assert body["error"]["operation"] == "crm.deal.update"
    assert "Se requiere 'lost_reason'" in body["error"]["message"]


def test_update_deal_move_to_lost_terminal_with_lost_reason(client: TestClient) -> None:
    """Con motivo, el cierre en terminal 'lost' queda registrado como PERDIDA."""
    headers = _fresh_tenant()
    _, open_stage = _create_stage(client, headers, order=0)
    _, lost_stage = _create_stage(client, headers, order=1, is_terminal=True, outcome="lost")
    _, created = _create_deal(client, uuid.UUID(open_stage["id"]), headers=headers)

    response = client.patch(
        f"/api/v1/crm/deals/{created['id']}",
        json={"stage_id": lost_stage["id"], "lost_reason": "Precio fuera de rango"},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "lost"
    assert body["lost_reason"] == "Precio fuera de rango"
    assert body["lost_at"] is not None
    assert body["closed_at"] is not None
    assert body["won_at"] is None


def test_update_deal_reopen_clears_close_timestamps(client: TestClient) -> None:
    """Reabrir a una etapa no terminal limpia las marcas de cierre y el motivo."""
    headers = _fresh_tenant()
    _, open_stage = _create_stage(client, headers, order=0)
    _, lost_stage = _create_stage(client, headers, order=1, is_terminal=True, outcome="lost")
    _, created = _create_deal(client, uuid.UUID(open_stage["id"]), headers=headers)

    client.patch(
        f"/api/v1/crm/deals/{created['id']}",
        json={"stage_id": lost_stage["id"], "lost_reason": "Seguimiento"},
        headers=headers,
    )
    response = client.patch(
        f"/api/v1/crm/deals/{created['id']}",
        json={"stage_id": open_stage["id"]},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "open"
    assert body["closed_at"] is None
    assert body["won_at"] is None
    assert body["lost_at"] is None
    assert body["lost_reason"] is None
    assert body["revision"] == 3


def test_delete_deal_returns_204(client: TestClient) -> None:
    """Soft-delete de una oportunidad → 204 y luego 404."""
    headers = _fresh_tenant()
    _, stage = _create_stage(client, headers)
    _, created = _create_deal(client, uuid.UUID(stage["id"]), headers=headers)
    response = client.delete(f"/api/v1/crm/deals/{created['id']}", headers=headers)
    assert response.status_code == 204, response.text
    gone = client.get(f"/api/v1/crm/deals/{created['id']}", headers=headers)
    assert gone.status_code == 404


def test_delete_missing_deal_returns_404(client: TestClient) -> None:
    """Eliminar una oportunidad inexistente → 404 ``crm.deal.delete``."""
    response = client.delete(f"/api/v1/crm/deals/{uuid.uuid4()}", headers=TENANT_HEADERS)
    assert response.status_code == 404, response.text
    body = response.json()
    assert body["error"]["code"] == "resource.not_found"
    assert body["error"]["operation"] == "crm.deal.delete"


def test_deal_history_missing_deal_returns_404(client: TestClient) -> None:
    """Historial de una oportunidad inexistente → 404 ``crm.deal.history``."""
    response = client.get(
        f"/api/v1/crm/deals/{uuid.uuid4()}/history", headers=TENANT_HEADERS
    )
    assert response.status_code == 404, response.text
    body = response.json()
    assert body["error"]["code"] == "resource.not_found"
    assert body["error"]["operation"] == "crm.deal.history"


# ────────────────────────────────────────────────────────────────────────────
# Tareas (/api/v1/crm/tasks)
# ────────────────────────────────────────────────────────────────────────────


def test_create_task_returns_201(client: TestClient) -> None:
    """Crea una tarea sin vínculo y devuelve la tupla sync inicial."""
    payload, body = _create_task(client)
    assert body["title"] == payload["title"]
    assert body["status"] == "pending"
    assert body["priority"] == "medium"
    assert body["deal_id"] is None
    assert body["completed_at"] is None
    assert body["revision"] == 1


def test_create_task_via_deal_binds_deal_id(client: TestClient) -> None:
    """POST ``/deals/{id}/tasks`` vincula la tarea a la oportunidad."""
    headers = _fresh_tenant()
    _, stage = _create_stage(client, headers)
    _, deal = _create_deal(client, uuid.UUID(stage["id"]), headers=headers)
    payload = _task_payload()
    response = client.post(
        f"/api/v1/crm/deals/{deal['id']}/tasks", json=payload, headers=headers
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["deal_id"] == deal["id"]
    assert body["title"] == payload["title"]


def test_create_task_unknown_deal_returns_404(client: TestClient) -> None:
    """Tarea con ``deal_id`` inexistente → 404 ``crm.task.create``."""
    response = client.post(
        "/api/v1/crm/tasks",
        json=_task_payload(deal_id=str(uuid.uuid4())),
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 404, response.text
    body = response.json()
    assert body["error"]["code"] == "resource.not_found"
    assert body["error"]["operation"] == "crm.task.create"
    assert "Oportunidad no encontrada" in body["error"]["message"]


def test_list_tasks_filters_by_deal(client: TestClient) -> None:
    """Filtro por ``deal_id`` y listado anidado ``/deals/{id}/tasks``."""
    headers = _fresh_tenant()
    _, stage = _create_stage(client, headers)
    _, deal = _create_deal(client, uuid.UUID(stage["id"]), headers=headers)
    _create_task(client, headers, deal_id=deal["id"])
    _create_task(client, headers, deal_id=deal["id"])
    _create_task(client, headers)

    filtered = client.get(
        f"/api/v1/crm/tasks?deal_id={deal['id']}", headers=headers
    )
    assert filtered.status_code == 200, filtered.text
    assert filtered.json()["total"] == 2

    nested = client.get(f"/api/v1/crm/deals/{deal['id']}/tasks", headers=headers)
    assert nested.status_code == 200, nested.text
    assert nested.json()["total"] == 2


def test_get_task_roundtrip(client: TestClient) -> None:
    """Obtener una tarea devuelve exactamente lo creado."""
    _, created = _create_task(client, TENANT_HEADERS)
    response = client.get(f"/api/v1/crm/tasks/{created['id']}", headers=TENANT_HEADERS)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["id"] == created["id"]
    assert body["title"] == created["title"]
    assert body["revision"] == 1


def test_get_missing_task_returns_404(client: TestClient) -> None:
    """Tarea inexistente → 404 ``crm.task.get``."""
    response = client.get(f"/api/v1/crm/tasks/{uuid.uuid4()}", headers=TENANT_HEADERS)
    assert response.status_code == 404, response.text
    body = response.json()
    assert body["error"]["code"] == "resource.not_found"
    assert body["error"]["operation"] == "crm.task.get"
    assert "Tarea no encontrada" in body["error"]["message"]


def test_update_task_done_sets_completed_at(client: TestClient) -> None:
    """Marcar como ``done`` fija ``completed_at`` y sube la revisión."""
    _, created = _create_task(client, TENANT_HEADERS)
    response = client.patch(
        f"/api/v1/crm/tasks/{created['id']}",
        json={"status": "done"},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "done"
    assert body["completed_at"] is not None
    assert body["revision"] == 2


def test_update_task_reopen_clears_completed_at(client: TestClient) -> None:
    """Reabrir a ``pending`` limpia ``completed_at``."""
    _, created = _create_task(client, TENANT_HEADERS)
    client.patch(
        f"/api/v1/crm/tasks/{created['id']}",
        json={"status": "done"},
        headers=TENANT_HEADERS,
    )
    response = client.patch(
        f"/api/v1/crm/tasks/{created['id']}",
        json={"status": "pending"},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "pending"
    assert body["completed_at"] is None


def test_update_task_empty_patch_returns_422(client: TestClient) -> None:
    """PATCH vacío → 422 (fail-fast)."""
    _, created = _create_task(client, TENANT_HEADERS)
    response = client.patch(
        f"/api/v1/crm/tasks/{created['id']}", json={}, headers=TENANT_HEADERS
    )
    assert response.status_code == 422, response.text
    body = response.json()
    assert body["error"]["code"] == "validation.input_error"
    assert body["error"]["operation"] == "crm.task.update"


def test_update_task_unknown_deal_returns_404(client: TestClient) -> None:
    """Vincular la tarea a una oportunidad inexistente → 404 ``crm.task.update``."""
    _, created = _create_task(client, TENANT_HEADERS)
    response = client.patch(
        f"/api/v1/crm/tasks/{created['id']}",
        json={"deal_id": str(uuid.uuid4())},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 404, response.text
    body = response.json()
    assert body["error"]["code"] == "resource.not_found"
    assert body["error"]["operation"] == "crm.task.update"
    assert "Oportunidad no encontrada" in body["error"]["message"]


def test_delete_task_returns_204(client: TestClient) -> None:
    """Soft-delete de una tarea → 204 y luego 404."""
    _, created = _create_task(client, TENANT_HEADERS)
    response = client.delete(f"/api/v1/crm/tasks/{created['id']}", headers=TENANT_HEADERS)
    assert response.status_code == 204, response.text
    gone = client.get(f"/api/v1/crm/tasks/{created['id']}", headers=TENANT_HEADERS)
    assert gone.status_code == 404


def test_delete_missing_task_returns_404(client: TestClient) -> None:
    """Eliminar una tarea inexistente → 404 ``crm.task.delete``."""
    response = client.delete(f"/api/v1/crm/tasks/{uuid.uuid4()}", headers=TENANT_HEADERS)
    assert response.status_code == 404, response.text
    body = response.json()
    assert body["error"]["code"] == "resource.not_found"
    assert body["error"]["operation"] == "crm.task.delete"


# ────────────────────────────────────────────────────────────────────────────
# SLA (/api/v1/crm/sla)
# ────────────────────────────────────────────────────────────────────────────


def test_upsert_sla_creates_policy(client: TestClient) -> None:
    """PUT crea la política SLA de la etapa (revision == 1)."""
    _, stage = _create_stage(client, TENANT_HEADERS)
    payload, body = _sla_payload(uuid.UUID(stage["id"])), None
    response = client.put("/api/v1/crm/sla", json=payload, headers=TENANT_HEADERS)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["stage_id"] == stage["id"]
    assert body["max_response_hours"] == 24
    assert body["max_stay_days"] == 7
    assert body["revision"] == 1


def test_upsert_sla_overwrite_updates_in_place(client: TestClient) -> None:
    """Re-UPSERT conserva el id y sube la revisión (actualización en sitio)."""
    _, stage = _create_stage(client, TENANT_HEADERS)
    first = client.put(
        "/api/v1/crm/sla",
        json=_sla_payload(uuid.UUID(stage["id"])),
        headers=TENANT_HEADERS,
    ).json()

    second = client.put(
        "/api/v1/crm/sla",
        json=_sla_payload(
            uuid.UUID(stage["id"]), max_response_hours=4, max_stay_days=2
        ),
        headers=TENANT_HEADERS,
    ).json()

    assert second["id"] == first["id"]
    assert second["revision"] == 2
    assert second["max_response_hours"] == 4
    assert second["max_stay_days"] == 2


def test_upsert_sla_unknown_stage_returns_404(client: TestClient) -> None:
    """SLA para una etapa inexistente → 404 ``crm.sla.upsert``."""
    response = client.put(
        "/api/v1/crm/sla",
        json=_sla_payload(uuid.uuid4()),
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 404, response.text
    body = response.json()
    assert body["error"]["code"] == "resource.not_found"
    assert body["error"]["operation"] == "crm.sla.upsert"
    assert "Etapa no encontrada" in body["error"]["message"]


def test_list_sla_returns_policies(client: TestClient) -> None:
    """Lista las políticas SLA del tenant."""
    headers = _fresh_tenant()
    _, stage = _create_stage(client, headers)
    client.put(
        "/api/v1/crm/sla",
        json=_sla_payload(uuid.UUID(stage["id"])),
        headers=headers,
    )
    response = client.get("/api/v1/crm/sla", headers=headers)
    assert response.status_code == 200, response.text
    policies = response.json()
    assert len(policies) == 1
    assert policies[0]["stage_id"] == stage["id"]


# ────────────────────────────────────────────────────────────────────────────
# Embudo (/api/v1/crm/funnel)
# ────────────────────────────────────────────────────────────────────────────


def test_funnel_aggregates_stages_and_close_rates(client: TestClient) -> None:
    """El embudo solo agrega etapas con oportunidades abiertas, ordenadas por ``order``.

    - ``stages`` hace inner join con ``status == open``: una etapa sin deals
      abiertos NO aparece (aunque tenga cierres won/lost).
    - ``conversion_rate`` compara etapas adyacentes (última → ``None``).
    - ``open_count = total - won - lost``; ``close_rate = won / (won + lost)``.
    """
    headers = _fresh_tenant()
    _, s1 = _create_stage(client, headers, order=0, default_probability=20)
    _, s2 = _create_stage(client, headers, order=1, default_probability=60)
    _, ganado = _create_stage(client, headers, order=2, is_terminal=True, outcome="won")
    _, perdido = _create_stage(client, headers, order=3, is_terminal=True, outcome="lost")

    # s1: una se gana, una se pierde y DOS permanecen abiertas (s1 debe seguir
    # apareciendo en ``stages`` porque el join es sobre deals abiertos).
    _, deal_a = _create_deal(
        client, uuid.UUID(s1["id"]), headers=headers, amount_minor=1000
    )
    _, deal_b = _create_deal(
        client, uuid.UUID(s1["id"]), headers=headers, amount_minor=2000
    )
    _, deal_c = _create_deal(
        client, uuid.UUID(s1["id"]), headers=headers, amount_minor=3000
    )
    _, deal_d = _create_deal(
        client, uuid.UUID(s1["id"]), headers=headers, amount_minor=1500
    )
    # s2: una oportunidad abierta.
    _, deal_e = _create_deal(
        client, uuid.UUID(s2["id"]), headers=headers, amount_minor=500
    )

    client.patch(
        f"/api/v1/crm/deals/{deal_a['id']}",
        json={"stage_id": ganado["id"]},
        headers=headers,
    )
    client.patch(
        f"/api/v1/crm/deals/{deal_b['id']}",
        json={"stage_id": perdido["id"], "lost_reason": "No disponible"},
        headers=headers,
    )

    response = client.get("/api/v1/crm/funnel", headers=headers)
    assert response.status_code == 200, response.text
    body = response.json()

    # Las etapas con oportunidades abiertas, ordenadas por ``order`` (s1 → s2).
    stages = body["stages"]
    assert [s["stage_id"] for s in stages] == [s1["id"], s2["id"]]
    assert stages[0]["count"] == 2  # deal_c + deal_d (deal_a/b se cerraron)
    assert stages[1]["count"] == 1  # deal_e
    assert stages[0]["total_amount_minor"] == 4500  # 3000 + 1500
    assert stages[1]["total_amount_minor"] == 500
    # Conversión de s1 → s2 = 1/2; la última etapa no tiene conversión.
    assert stages[0]["conversion_rate"] == 0.5
    assert stages[1]["conversion_rate"] is None
    assert stages[0]["avg_cycle_days"] is None

    assert body["total_deals"] == 5
    assert body["open_count"] == 3  # deal_c + deal_d + deal_e
    assert body["won_count"] == 1
    assert body["lost_count"] == 1
    assert body["won_amount_minor"] == 1000
    assert body["close_rate"] == 0.5
    assert body["avg_cycle_days"] is not None


# ────────────────────────────────────────────────────────────────────────────
# Resumen (/api/v1/crm/summary)
# ────────────────────────────────────────────────────────────────────────────


def test_summary_returns_deals_and_tasks_for_contact(
    client: TestClient, db_session, tenant_id: uuid.UUID
) -> None:
    """El resumen liga oportunidades y tareas de un contacto por email.

    El contacto se crea a nivel repositorio y se hace ``commit`` explícito
    porque la API lee con una sesión distinta (SQLite no ve filas sin commit
    entre sesiones).
    """
    email = f"cliente-{uuid.uuid4().hex[:8]}@example.com"
    contact = SqlAlchemyContactRepository(db_session).create(
        tenant_id=tenant_id,
        phone=f"+52 55 8888 {uuid.uuid4().hex[:4]}",
        name="Cliente CRM",
        email=email,
        tags=[],
        state="active",
        source="crm",
        external_contact_id=None,
        last_contact_at=None,
    )
    db_session.commit()

    _, stage = _create_stage(client, TENANT_HEADERS)
    _, deal = _create_deal(
        client,
        uuid.UUID(stage["id"]),
        contact_id=str(contact.id),
    )
    _create_task(client, contact_id=str(contact.id))

    response = client.get(
        f"/api/v1/crm/summary?email={email}", headers=TENANT_HEADERS
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total_deals"] == 1
    assert body["open_deals"] == 1
    assert body["won_deals"] == 0
    assert [d["id"] for d in body["deals"]] == [deal["id"]]
    assert len(body["tasks"]) == 1
    assert body["deals"][0]["contact_id"] == str(contact.id)


def test_summary_unknown_email_returns_empty(client: TestClient) -> None:
    """Email sin contacto → resumen vacío (sin errores)."""
    response = client.get(
        f"/api/v1/crm/summary?email=nobody-{uuid.uuid4().hex[:8]}@example.com",
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["deals"] == []
    assert body["tasks"] == []
    assert body["total_deals"] == 0
    assert body["open_deals"] == 0
    assert body["won_deals"] == 0


# ────────────────────────────────────────────────────────────────────────────
# P2: Orquestación (ciclo ⑤→⑥→⑩ — lead.needs_human → Deal+Task → Ganado)
# ────────────────────────────────────────────────────────────────────────────
# Valida el desacoplamiento por eventos del plan P2: ``capture_lead`` con
# ``metadata.needs_human`` dispara la auto-creación de la oportunidad + tarea
# (M3/M5) y ``confirm_checkout`` registra la sugerencia ``Ganado`` (M1), sin
# importaciones cruzadas (el emisor ``ICrmEventPublisher`` se inyecta por DI).
# Usa tenantes frescos para un pipeline determinista (dev-tenant acumula
# etapas de otros tests).


def _seed_pipeline(
    client: TestClient, headers: dict[str, str]
) -> dict[str, dict[str, str]]:
    """Siembra un pipeline determinista y devuelve las etapas por rol."""
    _, s1 = _create_stage(client, headers, order=0, default_probability=20)
    _, s2 = _create_stage(client, headers, order=1, default_probability=60)
    _, ganado = _create_stage(client, headers, order=2, is_terminal=True, outcome="won")
    _, perdido = _create_stage(client, headers, order=3, is_terminal=True, outcome="lost")
    return {"s1": s1, "s2": s2, "won": ganado, "lost": perdido}


def _upsert_sla(client: TestClient, headers: dict[str, str], stage_id: str) -> None:
    """Upserta una política SLA de 24 h para la etapa indicada (M5)."""
    response = client.put(
        "/api/v1/crm/sla",
        json=_sla_payload(uuid.UUID(stage_id), max_response_hours=24),
        headers=headers,
    )
    assert response.status_code == 200, response.text


def _find_deal(
    client: TestClient, headers: dict[str, str], title: str
) -> dict[str, Any] | None:
    """Busca una oportunidad por título en la página de deals."""
    body = client.get("/api/v1/crm/deals", headers=headers).json()
    return next((item for item in body["items"] if item["title"] == title), None)


def _find_task(
    client: TestClient, headers: dict[str, str], title: str
) -> dict[str, Any] | None:
    """Busca una tarea por título en la página de tareas."""
    body = client.get("/api/v1/crm/tasks", headers=headers).json()
    return next((item for item in body["items"] if item["title"] == title), None)


def _capture_lead(
    client: TestClient,
    headers: dict[str, str],
    email: str,
    *,
    name: str,
    phone: str,
    source: str = "landing",
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Captura un lead vía ``/api/v1/workflows/lead`` (201 esperado)."""
    payload: dict[str, Any] = {
        "name": name,
        "email": email,
        "phone": phone,
        "source": source,
        "metadata": metadata or {},
    }
    response = client.post("/api/v1/workflows/lead", json=payload, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


def test_lead_needs_human_auto_creates_deal_and_task(
    client: TestClient,
) -> None:
    """Un lead ``needs_human`` dispara Deal + Task con SLA (ciclo ⑤→⑥→⑩)."""
    headers = _fresh_tenant()
    pipeline = _seed_pipeline(client, headers)
    _upsert_sla(client, headers, pipeline["s1"]["id"])

    email = f"orq-{uuid.uuid4().hex[:8]}@example.com"
    lead = _capture_lead(
        client,
        headers,
        email,
        name="Ana Gómez",
        phone=f"+52 55 7000 {uuid.uuid4().hex[:4]}",
        metadata={"needs_human": True},
    )

    # M3: la oportunidad se coloca en la primera etapa no terminal (menor order).
    deal = _find_deal(client, headers, "Oportunidad: Ana Gómez")
    assert deal is not None, "Se esperaba la oportunidad auto-creada"
    assert deal["stage_id"] == pipeline["s1"]["id"]
    assert deal["status"] == "open"
    assert deal["probability"] == 20  # default_probability de s1
    assert deal["amount_minor"] == 0
    assert deal["currency"] == "USD"
    assert deal["metadata"]["origin"] == "lead_needs_human"
    assert deal["metadata"]["lead_source"] == "landing"
    assert deal["metadata"]["needs_human"] is True
    assert deal["lead_id"] == lead["id"]
    assert deal["contact_id"] is not None
    assert deal["revision"] == 1

    # M5: la tarea "Contactar al lead" vence según el SLA de 24 h de la etapa.
    task = _find_task(client, headers, "Contactar al lead")
    assert task is not None, "Se esperaba la tarea de seguimiento auto-creada"
    assert task["deal_id"] == deal["id"]
    assert task["contact_id"] == deal["contact_id"]
    assert task["status"] == "pending"
    assert task["priority"] == "high"
    assert task["due_at"] is not None
    # SQLite no conserva tzinfo: la API serializa fechas naive UTC (convención
    # del resto de la suite — ver test_scheduler._naive_utc). Se compara contra
    # "ahora" naive UTC para verificar que el SLA de 24 h se aplicó (M5).
    due_at = datetime.fromisoformat(task["due_at"])
    delta = due_at - datetime.now(timezone.utc).replace(tzinfo=None)
    assert timedelta(hours=23) < delta < timedelta(hours=25)

    # Historial: creación desde ``None`` → s1 por el sistema.
    history = client.get(
        f"/api/v1/crm/deals/{deal['id']}/history", headers=headers
    ).json()
    assert len(history) == 1
    assert history[0]["from_stage_id"] is None
    assert history[0]["to_stage_id"] == pipeline["s1"]["id"]
    assert history[0]["changed_by"] == "sistema"
    assert history[0]["note"] == "Creación automática desde lead con atención humana"


def test_lead_needs_human_is_idempotent(client: TestClient) -> None:
    """Recapturar el mismo lead no duplica la oportunidad ni la tarea."""
    headers = _fresh_tenant()
    _, s1 = _create_stage(client, headers, order=0, default_probability=10)

    email = f"orq-{uuid.uuid4().hex[:8]}@example.com"
    name = "Ana Idempotente"
    phone = f"+52 55 8000 {uuid.uuid4().hex[:4]}"
    _capture_lead(
        client, headers, email, name=name, phone=phone, metadata={"needs_human": True}
    )
    _capture_lead(
        client, headers, email, name=name, phone=phone, metadata={"needs_human": True}
    )

    deals = client.get("/api/v1/crm/deals", headers=headers).json()
    target = [d for d in deals["items"] if d["title"] == f"Oportunidad: {name}"]
    assert len(target) == 1

    tasks = client.get("/api/v1/crm/tasks", headers=headers).json()
    follow = [t for t in tasks["items"] if t["title"] == "Contactar al lead"]
    assert len(follow) == 1


def test_lead_without_needs_human_skips_orchestration(client: TestClient) -> None:
    """Sin la marca ``needs_human`` no se auto-crea nada (comportamiento previo)."""
    headers = _fresh_tenant()
    _, s1 = _create_stage(client, headers, order=0, default_probability=10)

    _capture_lead(
        client,
        headers,
        f"orq-{uuid.uuid4().hex[:8]}@example.com",
        name="Ana Sin Marca",
        phone=f"+52 55 9000 {uuid.uuid4().hex[:4]}",
    )

    deals = client.get("/api/v1/crm/deals", headers=headers).json()
    assert deals["total"] == 0

    tasks = client.get("/api/v1/crm/tasks", headers=headers).json()
    assert all(t["title"] != "Contactar al lead" for t in tasks["items"])


def test_lead_needs_human_without_pipeline_is_best_effort(client: TestClient) -> None:
    """Sin etapa no terminal, la captura no falla y se omite la orquestación."""
    headers = _fresh_tenant()

    lead = _capture_lead(
        client,
        headers,
        f"orq-{uuid.uuid4().hex[:8]}@example.com",
        name="Ana Sin Pipeline",
        phone=f"+52 55 9100 {uuid.uuid4().hex[:4]}",
        metadata={"needs_human": True},
    )
    assert lead["id"]

    deals = client.get("/api/v1/crm/deals", headers=headers).json()
    assert deals["total"] == 0


def test_payment_confirmed_suggests_won_and_moving_win_closes(
    client: TestClient,
) -> None:
    """Confirmar el pago sugiere ``Ganado`` y el vendedor cierra el deal (⑥→⑩)."""
    headers = _fresh_tenant()
    pipeline = _seed_pipeline(client, headers)
    _upsert_sla(client, headers, pipeline["s1"]["id"])

    email = f"orq-{uuid.uuid4().hex[:8]}@example.com"
    _capture_lead(
        client,
        headers,
        email,
        name="Ana Compradora",
        phone=f"+52 55 9200 {uuid.uuid4().hex[:4]}",
        metadata={"needs_human": True},
    )
    deal = _find_deal(client, headers, "Oportunidad: Ana Compradora")
    assert deal is not None

    checkout = client.post(
        "/api/v1/workflows/checkout",
        json={
            "amount": "99.50",
            "currency": "usd",
            "customer_email": email,
            "customer_name": "Ana Compradora",
            "metadata": {},
        },
        headers=headers,
    )
    assert checkout.status_code == 201, checkout.text
    payment_id = checkout.json()["payment_id"]

    confirmed = client.post(
        f"/api/v1/workflows/checkout/{payment_id}/confirm", headers=headers
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["status"] == "succeeded"

    # M1: la sugerencia ``Ganado`` se registra sin mover el deal.
    suggested = _find_deal(client, headers, "Oportunidad: Ana Compradora")
    assert suggested is not None
    assert suggested["status"] == "open"
    assert suggested["metadata"]["crm_suggestion"]["type"] == "won"
    assert suggested["metadata"]["crm_suggestion"]["source"].startswith("payment:")
    assert "suggested_at" in suggested["metadata"]["crm_suggestion"]

    # El vendedor mueve el deal a la etapa terminal "Ganado" → cierre.
    moved = client.patch(
        f"/api/v1/crm/deals/{suggested['id']}",
        json={"stage_id": pipeline["won"]["id"]},
        headers=headers,
    )
    assert moved.status_code == 200, moved.text
    closed = moved.json()
    assert closed["status"] == "won"
    assert closed["stage_id"] == pipeline["won"]["id"]
    assert closed["won_at"] is not None
    assert closed["closed_at"] is not None

    # ⑩: el embudo contabiliza el cierre ganado.
    funnel = client.get("/api/v1/crm/funnel", headers=headers)
    assert funnel.status_code == 200, funnel.text
    body = funnel.json()
    assert body["total_deals"] == 1
    assert body["won_count"] == 1
    assert body["lost_count"] == 0
    assert body["open_count"] == 0
    assert body["close_rate"] == 1.0
