"""Tests de integración del Portal del Cliente (C-3) vía HTTP.

Cubre el área privada y con login del comprador final:
- Login: emisión de token firmado (HMAC) solo para correos con registros en el
  tenant activo; normalización a minúsculas; errores 403/422 (fail-closed).
- Autenticación de las rutas protegidas (``Authorization: Bearer`` + tenant).
- Autoservicio: resumen del pedido/oportunidad y páginas de pagos, leads,
  cotizaciones y citas del correo autenticado (aislamiento por correo).
- Propiedad del detalle de pago (404 si es ajeno: no filtra existencia).
- Privacidad ARCO (LFPDPPP): exportación y borrado reutilizando
  :class:`BotPrivacyService` (mismo flujo que ``/bot/privacy/*``).

Reuso (regla CLAUDE — sin duplicación): siembra los datos del cliente con los
mismos endpoints de workflows que usa la operación (``/api/v1/workflows/*``).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from fastapi.testclient import TestClient

from app.core.di import Container
from app.repositories.sqlalchemy_repositories import SqlAlchemyContactRepository
from app.services.portal_tokens import sign_portal_token

TENANT_HEADERS: dict[str, str] = {"X-Tenant-Id": "dev-tenant"}
CLIENT_EMAIL = "cliente@example.com"
OTHER_EMAIL = "otro@example.com"


# ────────────────────────────────────────────────────────────────────────────
# Helpers de payload y siembra (mismos cuerpos que /api/v1/workflows/*)
# ────────────────────────────────────────────────────────────────────────────


def _checkout_payload(**overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "amount": "99.50",
        "currency": "usd",
        "customer_email": CLIENT_EMAIL,
        "customer_name": "Cliente Demo",
        "metadata": {"campaign": "c1"},
    }
    payload.update(overrides)
    return payload


def _lead_payload(**overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "name": "Ana Pérez",
        "email": CLIENT_EMAIL,
        "phone": "+52 55 1234 5678",
        "source": "landing",
    }
    payload.update(overrides)
    return payload


def _quote_payload(**overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "customer_name": "Cliente Demo",
        "customer_email": CLIENT_EMAIL,
        "currency": "usd",
        "services": [
            {"name": "Consultoría", "quantity": 1, "unit_price": "100.00"},
            {"name": "Soporte", "quantity": 2, "unit_price": "25.50"},
        ],
        "tax_rate_bps": 1600,
    }
    payload.update(overrides)
    return payload


def _appointment_payload(**overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "service": "Consulta inicial",
        "starts_at": "2026-08-25T15:00:00Z",
        "duration_minutes": 60,
        "timezone": "America/Mexico_City",
        "customer_name": "Ana Pérez",
        "customer_email": CLIENT_EMAIL,
        "customer_phone": "+52 55 1234 5678",
        "notes": "Primera reunión",
    }
    payload.update(overrides)
    return payload


def _seed_client(
    client: TestClient, *, email: str = CLIENT_EMAIL, phone: str | None = None
) -> dict[str, Any]:
    """Siembra un pago, lead, cotización y cita para el correo indicado.

    Usa la misma API de workflows (operación real) — sin insertar filas a mano.
    ``phone`` (opcional) fija el teléfono del lead y la cita para anclar el lead
    al mismo contacto del directorio (propagación por teléfono); por defecto el
    teléfono fijo del payload.
    """
    payment = client.post(
        "/api/v1/workflows/checkout",
        json=_checkout_payload(customer_email=email),
        headers=TENANT_HEADERS,
    )
    assert payment.status_code == 201, payment.text
    lead_payload = _lead_payload(email=email)
    if phone is not None:
        lead_payload["phone"] = phone
    lead = client.post(
        "/api/v1/workflows/lead",
        json=lead_payload,
        headers=TENANT_HEADERS,
    )
    assert lead.status_code == 201, lead.text
    quote = client.post(
        "/api/v1/workflows/quote",
        json=_quote_payload(customer_email=email),
        headers=TENANT_HEADERS,
    )
    assert quote.status_code == 201, quote.text
    appointment_payload = _appointment_payload(customer_email=email)
    if phone is not None:
        appointment_payload["customer_phone"] = phone
    appointment = client.post(
        "/api/v1/workflows/appointment",
        json=appointment_payload,
        headers=TENANT_HEADERS,
    )
    assert appointment.status_code == 201, appointment.text
    return {
        "payment_id": payment.json()["payment_id"],
        "lead_id": lead.json()["id"],
        "quote_id": quote.json()["quote_id"],
        "appointment_id": appointment.json()["appointment_id"],
    }


def _portal_login(client: TestClient, *, email: str = CLIENT_EMAIL) -> dict[str, Any]:
    """Inicia sesión en el portal y devuelve las credenciales (200)."""
    response = client.post(
        "/api/v1/portal/login", json={"email": email}, headers=TENANT_HEADERS
    )
    assert response.status_code == 200, response.text
    return response.json()


def _auth_headers(token: str) -> dict[str, str]:
    """Cabeceras del portal: tenant + Bearer token del cliente autenticado."""
    headers = dict(TENANT_HEADERS)
    headers["Authorization"] = f"Bearer {token}"
    return headers


def _crm_stage_payload(**overrides: Any) -> dict[str, Any]:
    """Payload válido de etapa CRM con nombre único (evita colisiones por tenant)."""
    payload: dict[str, Any] = {
        "name": f"Etapa {uuid.uuid4().hex[:8]}",
        "order": 0,
        "default_probability": 10,
        "is_terminal": False,
        "outcome": None,
    }
    payload.update(overrides)
    return payload


def _crm_deal_payload(stage_id: uuid.UUID, **overrides: Any) -> dict[str, Any]:
    """Payload válido de oportunidad CRM anclado a una etapa existente."""
    payload: dict[str, Any] = {
        "title": f"Deal {uuid.uuid4().hex[:8]}",
        "stage_id": str(stage_id),
        "amount_minor": 1_000_000,
        "currency": "MXN",
        "probability": 40,
    }
    payload.update(overrides)
    return payload


def _crm_task_payload(**overrides: Any) -> dict[str, Any]:
    """Payload válido de tarea CRM (pendiente por defecto)."""
    payload: dict[str, Any] = {
        "title": f"Tarea {uuid.uuid4().hex[:8]}",
        "status": "pending",
        "priority": "medium",
    }
    payload.update(overrides)
    return payload


def _crm_headers(token: str) -> dict[str, str]:
    """Cabeceras del CRM (RBAC de estudio): tenant + Bearer del tenant-admin."""
    headers = dict(TENANT_HEADERS)
    headers["Authorization"] = f"Bearer {token}"
    return headers


def _create_crm_stage(
    client: TestClient, token: str, **overrides: Any
) -> dict[str, Any]:
    """Crea una etapa CRM vía API y devuelve el cuerpo — 201 esperado."""
    response = client.post(
        "/api/v1/crm/stages",
        json=_crm_stage_payload(**overrides),
        headers=_crm_headers(token),
    )
    assert response.status_code == 201, response.text
    return response.json()


def _create_crm_deal(
    client: TestClient, token: str, stage_id: uuid.UUID, **overrides: Any
) -> dict[str, Any]:
    """Crea una oportunidad CRM vía API y devuelve el cuerpo — 201 esperado."""
    response = client.post(
        "/api/v1/crm/deals",
        json=_crm_deal_payload(stage_id, **overrides),
        headers=_crm_headers(token),
    )
    assert response.status_code == 201, response.text
    return response.json()


def _create_crm_task(
    client: TestClient, token: str, **overrides: Any
) -> dict[str, Any]:
    """Crea una tarea CRM vía API y devuelve el cuerpo — 201 esperado."""
    response = client.post(
        "/api/v1/crm/tasks",
        json=_crm_task_payload(**overrides),
        headers=_crm_headers(token),
    )
    assert response.status_code == 201, response.text
    return response.json()


# ────────────────────────────────────────────────────────────────────────────
# LOGIN
# ────────────────────────────────────────────────────────────────────────────


def test_login_success_returns_token(client: TestClient) -> None:
    """Un correo con registros en el tenant recibe un token firmado + vigencia."""
    _seed_client(client)
    body = _portal_login(client)
    assert body["email"] == CLIENT_EMAIL
    assert body["token"]
    # El token es el formato compacto ``payload.signature``.
    assert len(body["token"].split(".")) == 2
    # ``expires_at`` es una fecha futura parseable (vigencia de 24 h).
    expires_at = datetime.fromisoformat(body["expires_at"])
    assert expires_at.tzinfo is not None


def test_login_normalizes_email_to_lowercase(client: TestClient) -> None:
    """El login normaliza mayúsculas/espacios antes de buscar registros."""
    _seed_client(client)
    body = _portal_login(client, email="CLIENTE@Example.COM")
    assert body["email"] == CLIENT_EMAIL
    assert body["token"]


def test_login_unknown_email_returns_403(client: TestClient) -> None:
    """Un correo sin registros en el tenant no obtiene token (fail-closed)."""
    unknown = f"{uuid.uuid4().hex}@example.com"
    response = client.post(
        "/api/v1/portal/login", json={"email": unknown}, headers=TENANT_HEADERS
    )
    assert response.status_code == 403
    error = response.json()["error"]
    assert error["code"] == "tenant.isolation_violation"
    assert error["operation"] == "portal.login"


def test_login_invalid_email_returns_422(client: TestClient) -> None:
    """Un correo mal formado es rechazado por el contrato del esquema."""
    response = client.post(
        "/api/v1/portal/login", json={"email": "correo-invalido"}, headers=TENANT_HEADERS
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation.request_error"


def test_login_missing_tenant_returns_403(client: TestClient) -> None:
    """Sin cabecera X-Tenant-Id el login se rechaza (aislamiento)."""
    _seed_client(client)
    response = client.post("/api/v1/portal/login", json={"email": CLIENT_EMAIL})
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "tenant.isolation_violation"


# ────────────────────────────────────────────────────────────────────────────
# AUTENTICACIÓN DE RUTAS PROTEGIDAS
# ────────────────────────────────────────────────────────────────────────────


def test_protected_endpoint_without_bearer_returns_403(client: TestClient) -> None:
    """Sin Bearer token el portal rechaza con 403 (fail-closed)."""
    _seed_client(client)
    response = client.get("/api/v1/portal/summary", headers=TENANT_HEADERS)
    assert response.status_code == 403
    error = response.json()["error"]
    assert error["code"] == "tenant.isolation_violation"
    assert error["operation"] == "portal.client.authenticate"


def test_protected_endpoint_malformed_bearer_returns_403(client: TestClient) -> None:
    """Un esquema de autorización que no es ``Bearer`` se rechaza."""
    _seed_client(client)
    headers = dict(TENANT_HEADERS)
    headers["Authorization"] = "Token abc"
    response = client.get("/api/v1/portal/summary", headers=headers)
    assert response.status_code == 403
    assert response.json()["error"]["operation"] == "portal.client.authenticate"


def test_protected_endpoint_invalid_token_returns_403(client: TestClient) -> None:
    """Un token corrupto se rechaza durante la verificación de firma."""
    _seed_client(client)
    response = client.get(
        "/api/v1/portal/summary",
        headers=_auth_headers("no-es-un-token-valido"),
    )
    assert response.status_code == 403
    assert response.json()["error"]["operation"] == "portal.client.authenticate"


def test_protected_endpoint_wrong_tenant_token_returns_403(
    client: TestClient, container: Container
) -> None:
    """Un token firmado para otro tenant no autoriza en el tenant activo."""
    _seed_client(client)
    foreign_tenant = uuid.uuid4()
    token = sign_portal_token(
        secret=container.settings.portal_token_secret,
        tenant_id=foreign_tenant,
        email=CLIENT_EMAIL,
    )
    response = client.get("/api/v1/portal/summary", headers=_auth_headers(token))
    assert response.status_code == 403
    assert response.json()["error"]["operation"] == "portal.client.authenticate"


# ────────────────────────────────────────────────────────────────────────────
# AUTOSERVICIO (eslabón ⑥ cierre / ⑧ postventa)
# ────────────────────────────────────────────────────────────────────────────


def test_summary_returns_seeded_items(client: TestClient) -> None:
    """El resumen expone solo los datos del correo autenticado.

    Usa un correo único por prueba para que los conteos exactos no dependan de
    datos acumulados por otros tests de la misma sesión (SQLite compartido).
    """
    email = f"cliente-{uuid.uuid4().hex}@example.com"
    _seed_client(client, email=email)
    token = _portal_login(client, email=email)["token"]
    response = client.get("/api/v1/portal/summary", headers=_auth_headers(token))
    assert response.status_code == 200
    body = response.json()
    assert body["email"] == email
    assert len(body["payments"]) == 1
    assert len(body["leads"]) == 1
    assert len(body["quotes"]) == 1
    assert len(body["appointments"]) == 1
    assert body["payments"][0]["customer_email"] == email
    assert body["leads"][0]["email"] == email


def test_summary_includes_crm_opportunities_and_next_steps(
    client: TestClient,
    db_session,
    tenant_id: uuid.UUID,
    tenant_admin_token: str,
) -> None:
    """El resumen del portal expone oportunidades abiertas (con etapa) y próximos pasos.

    El contacto se crea a nivel repositorio con ``commit`` explícito porque la API
    lee con una sesión distinta (SQLite no ve filas sin commit); la oportunidad y
    la tarea se siembran vía la API de CRM (operación real) y el login exige
    registros de workflows (``_seed_client``).
    """
    email = f"cliente-crm-{uuid.uuid4().hex[:8]}@example.com"
    # Un solo cliente: el lead de workflows se propaga al directorio POR TELÉFONO
    # (``_propagate_contact``), así que el contacto y el lead deben compartir el
    # mismo teléfono. Si usaran teléfonos distintos, ``_propagate_contact``
    # reasignaría el correo al contacto del lead y ``get_by_email`` quedaría
    # indeterminado (dos contactos con el mismo correo, uno sin oportunidades).
    phone = f"+52 55 7777 {uuid.uuid4().hex[:4]}"
    contact = SqlAlchemyContactRepository(db_session).create(
        tenant_id=tenant_id,
        phone=phone,
        name="Cliente CRM Portal",
        email=email,
        tags=[],
        state="active",
        source="crm",
        external_contact_id=None,
        last_contact_at=None,
    )
    db_session.commit()

    stage = _create_crm_stage(client, tenant_admin_token)
    deal = _create_crm_deal(
        client,
        tenant_admin_token,
        uuid.UUID(stage["id"]),
        contact_id=str(contact.id),
        amount_minor=1_250_000,
        currency="MXN",
    )
    _create_crm_task(client, tenant_admin_token, contact_id=str(contact.id))

    _seed_client(client, email=email, phone=phone)
    token = _portal_login(client, email=email)["token"]
    response = client.get("/api/v1/portal/summary", headers=_auth_headers(token))
    assert response.status_code == 200, response.text
    body = response.json()
    assert [o["id"] for o in body["opportunities"]] == [deal["id"]]
    assert body["opportunities"][0]["stage_name"] == stage["name"]
    assert body["opportunities"][0]["amount_minor"] == 1_250_000
    assert body["opportunities"][0]["metadata"] == {}
    assert len(body["next_steps"]) == 1
    assert body["next_steps"][0]["status"] == "pending"


def test_list_payments_returns_page(client: TestClient) -> None:
    """Historial de pagos del cliente autenticado (recibos)."""
    _seed_client(client)
    token = _portal_login(client)["token"]
    response = client.get("/api/v1/portal/payments", headers=_auth_headers(token))
    assert response.status_code == 200
    body = response.json()
    assert body["total"] >= 1
    assert body["page"] == 1
    assert body["page_size"] == 20
    assert any(item["customer_email"] == CLIENT_EMAIL for item in body["items"])
    assert any(item["amount_minor"] == 9950 for item in body["items"])


def test_list_leads_returns_page(client: TestClient) -> None:
    """Solicitudes/leads del cliente autenticado."""
    _seed_client(client)
    token = _portal_login(client)["token"]
    response = client.get("/api/v1/portal/leads", headers=_auth_headers(token))
    assert response.status_code == 200
    body = response.json()
    assert body["total"] >= 1
    assert any(item["email"] == CLIENT_EMAIL for item in body["items"])


def test_list_quotes_returns_page(client: TestClient) -> None:
    """Cotizaciones del cliente autenticado."""
    _seed_client(client)
    token = _portal_login(client)["token"]
    response = client.get("/api/v1/portal/quotes", headers=_auth_headers(token))
    assert response.status_code == 200
    body = response.json()
    assert body["total"] >= 1
    assert any(item["customer_email"] == CLIENT_EMAIL for item in body["items"])


def test_list_appointments_returns_page(client: TestClient) -> None:
    """Citas del cliente autenticado."""
    _seed_client(client)
    token = _portal_login(client)["token"]
    response = client.get("/api/v1/portal/appointments", headers=_auth_headers(token))
    assert response.status_code == 200
    body = response.json()
    assert body["total"] >= 1
    assert any(item["customer_email"] == CLIENT_EMAIL for item in body["items"])


def test_get_payment_own_returns_200(client: TestClient) -> None:
    """El cliente puede ver el detalle de su propio pago (recibo)."""
    seeded = _seed_client(client)
    token = _portal_login(client)["token"]
    response = client.get(
        f"/api/v1/portal/payments/{seeded['payment_id']}",
        headers=_auth_headers(token),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == seeded["payment_id"]
    assert body["customer_email"] == CLIENT_EMAIL
    assert body["amount_minor"] == 9950


def test_get_payment_other_clients_returns_404(client: TestClient) -> None:
    """El detalle de un pago ajeno responde 404 (no filtra su existencia)."""
    own = _seed_client(client)
    other = _seed_client(client, email=OTHER_EMAIL)
    token = _portal_login(client, email=CLIENT_EMAIL)["token"]
    response = client.get(
        f"/api/v1/portal/payments/{other['payment_id']}",
        headers=_auth_headers(token),
    )
    assert response.status_code == 404
    error = response.json()["error"]
    assert error["code"] == "resource.not_found"
    assert error["operation"] == "portal.payment.get"
    # El pago propio sigue siendo accesible (aislamiento selectivo).
    own_response = client.get(
        f"/api/v1/portal/payments/{own['payment_id']}",
        headers=_auth_headers(token),
    )
    assert own_response.status_code == 200


def test_get_missing_payment_returns_404(client: TestClient) -> None:
    """Un pago inexistente en el tenant responde 404."""
    _seed_client(client)
    token = _portal_login(client)["token"]
    response = client.get(
        f"/api/v1/portal/payments/{uuid.uuid4()}",
        headers=_auth_headers(token),
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "resource.not_found"


# ────────────────────────────────────────────────────────────────────────────
# PRIVACIDAD (derechos ARCO, LFPDPPP — eslabón ⑧ autoservicio)
# ────────────────────────────────────────────────────────────────────────────


def test_privacy_export_returns_200(client: TestClient) -> None:
    """Exporta los datos del tenant (derecho de portabilidad) con login."""
    _seed_client(client)
    token = _portal_login(client)["token"]
    response = client.get(
        "/api/v1/portal/privacy/export", headers=_auth_headers(token)
    )
    assert response.status_code == 200
    body = response.json()
    assert body["tenant_id"]
    assert "conversations" in body
    assert "messages" in body


def test_privacy_erase_returns_200(client: TestClient) -> None:
    """Borra los datos del tenant (derecho de cancelación) con login."""
    _seed_client(client)
    token = _portal_login(client)["token"]
    response = client.delete(
        "/api/v1/portal/privacy/data", headers=_auth_headers(token)
    )
    assert response.status_code == 200
    body = response.json()
    assert body["tenant_id"]
    assert "deleted_conversations" in body
    assert "deleted_messages" in body
