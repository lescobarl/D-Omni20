"""Tests de los endpoints de workflows (checkout, leads, cotizaciones, citas) vía HTTP.

Cubre el caso de uso de conversión multi-tenant end-to-end:
- Checkout: creación (sandbox), confirmación idempotente, paginación y errores.
- Webhook: parsing de tenant (403/422) y firma (422 en sandbox).
- Leads: captura + notificación CRM (desactivada en tests), listado y errores.
- Cotizaciones: cálculo de totales + PDF real servido por /artifacts.
- Citas: agendamiento + invitación ICS real servida por /artifacts.
- Auditoría: cada operación queda registrada en el endpoint /audit.
"""

from __future__ import annotations

import json
import uuid
from typing import Any
from urllib.parse import urlparse

from fastapi.testclient import TestClient

TENANT_HEADERS: dict[str, str] = {"X-Tenant-Id": "dev-tenant"}


# ────────────────────────────────────────────────────────────────────────────
# Helpers de payload
# ────────────────────────────────────────────────────────────────────────────


def _checkout_payload(**overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "amount": "99.50",
        "currency": "usd",
        "customer_email": "cliente@example.com",
        "customer_name": "Cliente Demo",
        "metadata": {"campaign": "c1"},
    }
    payload.update(overrides)
    return payload


def _lead_payload(**overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "name": "Ana Pérez",
        "email": "ana@example.com",
        "phone": "+52 55 1234 5678",
        "source": "landing",
    }
    payload.update(overrides)
    return payload


def _quote_payload(**overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "customer_name": "Cliente Demo",
        "customer_email": "cliente@example.com",
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
        "customer_email": "ana@example.com",
        "customer_phone": "+52 55 1234 5678",
        "notes": "Primera reunión",
    }
    payload.update(overrides)
    return payload


def _webhook_payload(
    tenant_value: str | None, *, session_id: str = "cs_test_123"
) -> dict[str, Any]:
    metadata = {} if tenant_value is None else {"tenant_id": tenant_value}
    return {
        "type": "checkout.session.completed",
        "data": {"object": {"id": session_id, "metadata": metadata}},
    }


def _create_checkout(client: TestClient, **overrides: Any) -> dict[str, Any]:
    """Crea un checkout sandbox y devuelve el body (201)."""
    response = client.post(
        "/api/v1/workflows/checkout",
        json=_checkout_payload(**overrides),
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 201, response.text
    return response.json()


# ────────────────────────────────────────────────────────────────────────────
# CHECKOUT
# ────────────────────────────────────────────────────────────────────────────


def test_create_checkout_returns_201(client: TestClient) -> None:
    """Crea una sesión sandbox y devuelve la URL de la pasarela."""
    body = _create_checkout(client)
    assert body["status"] == "requires_confirmation"
    assert body["provider"] == "sandbox"
    assert body["checkout_url"].startswith("http://localhost:8000/workflows/sandbox/")
    assert body["payment_id"]


def test_create_checkout_missing_tenant_returns_403(client: TestClient) -> None:
    """Sin cabecera X-Tenant-Id el checkout se rechaza (aislamiento)."""
    response = client.post(
        "/api/v1/workflows/checkout", json=_checkout_payload()
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "tenant.isolation_violation"


def test_create_checkout_invalid_amount_returns_422(client: TestClient) -> None:
    """Un monto inválido (<= 0) es rechazado con 422."""
    response = client.post(
        "/api/v1/workflows/checkout",
        json=_checkout_payload(amount="0"),
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation.request_error"


def test_confirm_checkout_returns_succeeded(client: TestClient) -> None:
    """Confirma manualmente un pago sandbox pendiente."""
    body = _create_checkout(client)
    response = client.post(
        f"/api/v1/workflows/checkout/{body['payment_id']}/confirm",
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 200
    assert response.json()["status"] == "succeeded"


def test_confirm_checkout_is_idempotent(client: TestClient) -> None:
    """Confirmar dos veces el mismo pago no rompe (estado terminal)."""
    body = _create_checkout(client)
    url = f"/api/v1/workflows/checkout/{body['payment_id']}/confirm"
    first = client.post(url, headers=TENANT_HEADERS)
    second = client.post(url, headers=TENANT_HEADERS)
    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["status"] == "succeeded"
    assert second.json()["status"] == "succeeded"


def test_confirm_missing_payment_returns_404(client: TestClient) -> None:
    """Confirmar un pago inexistente devuelve 404."""
    response = client.post(
        f"/api/v1/workflows/checkout/{uuid.uuid4()}/confirm",
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "resource.not_found"


def test_get_payment_roundtrip(client: TestClient) -> None:
    """GET /payments/{id} devuelve la transacción con monto en minor units."""
    created = _create_checkout(client)
    response = client.get(
        f"/api/v1/workflows/payments/{created['payment_id']}",
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == created["payment_id"]
    assert body["amount_minor"] == 9950
    assert body["currency"] == "usd"
    assert body["status"] == "requires_confirmation"
    assert body["provider"] == "sandbox"
    assert body["metadata"]["campaign"] == "c1"


def test_list_payments_returns_page(client: TestClient) -> None:
    """Lista paginada de transacciones del tenant activo."""
    created = _create_checkout(client)
    response = client.get("/api/v1/workflows/payments", headers=TENANT_HEADERS)
    assert response.status_code == 200
    body = response.json()
    assert body["page"] == 1
    assert body["page_size"] == 20
    assert body["total"] >= 1
    assert any(item["id"] == created["payment_id"] for item in body["items"])


def test_get_missing_payment_returns_404(client: TestClient) -> None:
    """Pedir una transacción inexistente devuelve 404."""
    response = client.get(
        f"/api/v1/workflows/payments/{uuid.uuid4()}", headers=TENANT_HEADERS
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "resource.not_found"


# ────────────────────────────────────────────────────────────────────────────
# WEBHOOK (tenant desde el payload, sin X-Tenant-Id)
# ────────────────────────────────────────────────────────────────────────────


def test_webhook_missing_tenant_returns_403(client: TestClient) -> None:
    """Webhook sin tenant_id en metadata se rechaza (nunca se procesa sin tenant)."""
    payload = _webhook_payload(None)
    response = client.post(
        "/api/v1/workflows/checkout/webhook",
        content=json.dumps(payload),
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "tenant.isolation_violation"


def test_webhook_invalid_tenant_returns_403(client: TestClient) -> None:
    """Un tenant_id que no es UUID se rechaza con 403."""
    payload = _webhook_payload("no-es-uuid")
    response = client.post(
        "/api/v1/workflows/checkout/webhook",
        content=json.dumps(payload),
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "tenant.isolation_violation"


def test_webhook_invalid_json_returns_422(client: TestClient) -> None:
    """Un payload que no es JSON devuelve 422 con error estructurado."""
    response = client.post(
        "/api/v1/workflows/checkout/webhook",
        content=b"not-json",
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "validation.input_error"
    assert body["error"]["operation"] == "workflow.checkout.webhook"


def test_webhook_valid_tenant_signature_fails_returns_422(client: TestClient) -> None:
    """Con tenant válido la firma sandbox siempre falla → 422 (validación de firma)."""
    payload = _webhook_payload(str(uuid.uuid4()))
    response = client.post(
        "/api/v1/workflows/checkout/webhook",
        content=json.dumps(payload),
        headers={"Content-Type": "application/json", "Stripe-Signature": "t=1,v1=abc"},
    )
    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "validation.input_error"
    assert body["error"]["operation"] == "workflow.checkout.webhook"


# ────────────────────────────────────────────────────────────────────────────
# LEADS
# ────────────────────────────────────────────────────────────────────────────


def test_capture_lead_returns_201(client: TestClient) -> None:
    """Captura un prospecto y lo persiste con estado inicial new."""
    response = client.post(
        "/api/v1/workflows/lead",
        json=_lead_payload(),
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Ana Pérez"
    assert body["source"] == "landing"
    assert body["status"] == "new"
    assert body["id"]


def test_capture_lead_invalid_email_returns_422(client: TestClient) -> None:
    """Un email inválido es rechazado con 422."""
    response = client.post(
        "/api/v1/workflows/lead",
        json=_lead_payload(email="no-es-email"),
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation.request_error"


def test_get_lead_roundtrip(client: TestClient) -> None:
    """GET /leads/{id} devuelve el prospecto capturado."""
    created = client.post(
        "/api/v1/workflows/lead",
        json=_lead_payload(),
        headers=TENANT_HEADERS,
    ).json()
    response = client.get(
        f"/api/v1/workflows/leads/{created['id']}", headers=TENANT_HEADERS
    )
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == created["id"]
    assert body["email"] == "ana@example.com"


def test_list_leads_returns_page(client: TestClient) -> None:
    """Lista paginada de prospectos del tenant activo."""
    created = client.post(
        "/api/v1/workflows/lead",
        json=_lead_payload(),
        headers=TENANT_HEADERS,
    ).json()
    response = client.get("/api/v1/workflows/leads", headers=TENANT_HEADERS)
    assert response.status_code == 200
    body = response.json()
    assert body["page"] == 1
    assert body["page_size"] == 20
    assert body["total"] >= 1
    assert any(item["id"] == created["id"] for item in body["items"])


def test_get_missing_lead_returns_404(client: TestClient) -> None:
    """Pedir un prospecto inexistente devuelve 404."""
    response = client.get(
        f"/api/v1/workflows/leads/{uuid.uuid4()}", headers=TENANT_HEADERS
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "resource.not_found"


# ────────────────────────────────────────────────────────────────────────────
# COTIZACIONES (PDF real servido)
# ────────────────────────────────────────────────────────────────────────────


def test_generate_quote_returns_201(client: TestClient) -> None:
    """Calcula totales (subtotal/impuesto/total) y devuelve la URL del PDF."""
    response = client.post(
        "/api/v1/workflows/quote",
        json=_quote_payload(),
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "draft"
    assert body["subtotal"] == "151.00"
    assert body["tax"] == "24.16"
    assert body["total"] == "175.16"
    assert body["currency"] == "usd"
    assert body["pdf_url"].startswith("http://localhost:8000/artifacts/quote-")
    assert body["quote_id"]


def test_generated_pdf_is_served(client: TestClient) -> None:
    """El PDF generado es un PDF 1.4 real servido por /artifacts."""
    body = client.post(
        "/api/v1/workflows/quote",
        json=_quote_payload(),
        headers=TENANT_HEADERS,
    ).json()
    path = urlparse(body["pdf_url"]).path
    response = client.get(path)
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.content.startswith(b"%PDF")


def test_get_quote_roundtrip(client: TestClient) -> None:
    """GET /quotes/{id} devuelve la cotización con totales en minor units."""
    created = client.post(
        "/api/v1/workflows/quote",
        json=_quote_payload(),
        headers=TENANT_HEADERS,
    ).json()
    response = client.get(
        f"/api/v1/workflows/quotes/{created['quote_id']}", headers=TENANT_HEADERS
    )
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == created["quote_id"]
    assert body["subtotal_minor"] == 15100
    assert body["tax_minor"] == 2416
    assert body["total_minor"] == 17516
    assert body["status"] == "draft"
    assert body["pdf_path"]


def test_list_quotes_returns_page(client: TestClient) -> None:
    """Lista paginada de cotizaciones del tenant activo."""
    created = client.post(
        "/api/v1/workflows/quote",
        json=_quote_payload(),
        headers=TENANT_HEADERS,
    ).json()
    response = client.get("/api/v1/workflows/quotes", headers=TENANT_HEADERS)
    assert response.status_code == 200
    body = response.json()
    assert body["page"] == 1
    assert body["page_size"] == 20
    assert body["total"] >= 1
    assert any(item["id"] == created["quote_id"] for item in body["items"])


def test_get_missing_quote_returns_404(client: TestClient) -> None:
    """Pedir una cotización inexistente devuelve 404."""
    response = client.get(
        f"/api/v1/workflows/quotes/{uuid.uuid4()}", headers=TENANT_HEADERS
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "resource.not_found"


def test_generate_quote_empty_services_returns_422(client: TestClient) -> None:
    """Una cotización sin servicios es rechazada con 422."""
    response = client.post(
        "/api/v1/workflows/quote",
        json=_quote_payload(services=[]),
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation.request_error"


# ────────────────────────────────────────────────────────────────────────────
# CITAS (invitación ICS real servida)
# ────────────────────────────────────────────────────────────────────────────


def test_schedule_appointment_returns_201(client: TestClient) -> None:
    """Agenda una cita en UTC y devuelve la URL de la invitación ICS."""
    response = client.post(
        "/api/v1/workflows/appointment",
        json=_appointment_payload(),
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "scheduled"
    assert "2026-08-25T15:00:00" in body["starts_at"]
    assert "2026-08-25T16:00:00" in body["ends_at"]
    assert body["timezone"] == "America/Mexico_City"
    assert body["ics_url"].startswith("http://localhost:8000/artifacts/appointment-")
    assert body["appointment_id"]


def test_generated_ics_is_served(client: TestClient) -> None:
    """La invitación ICS es un VCALENDAR real servido por /artifacts."""
    body = client.post(
        "/api/v1/workflows/appointment",
        json=_appointment_payload(),
        headers=TENANT_HEADERS,
    ).json()
    path = urlparse(body["ics_url"]).path
    response = client.get(path)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/calendar")
    assert b"BEGIN:VCALENDAR" in response.content
    assert b"END:VCALENDAR" in response.content


def test_get_appointment_roundtrip(client: TestClient) -> None:
    """GET /appointments/{id} devuelve la cita agendada."""
    created = client.post(
        "/api/v1/workflows/appointment",
        json=_appointment_payload(),
        headers=TENANT_HEADERS,
    ).json()
    response = client.get(
        f"/api/v1/workflows/appointments/{created['appointment_id']}",
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == created["appointment_id"]
    assert body["service"] == "Consulta inicial"
    assert body["status"] == "scheduled"
    assert body["ics_path"]


def test_list_appointments_returns_page(client: TestClient) -> None:
    """Lista paginada de citas del tenant activo."""
    created = client.post(
        "/api/v1/workflows/appointment",
        json=_appointment_payload(),
        headers=TENANT_HEADERS,
    ).json()
    response = client.get("/api/v1/workflows/appointments", headers=TENANT_HEADERS)
    assert response.status_code == 200
    body = response.json()
    assert body["page"] == 1
    assert body["page_size"] == 20
    assert body["total"] >= 1
    assert any(item["id"] == created["appointment_id"] for item in body["items"])


def test_get_missing_appointment_returns_404(client: TestClient) -> None:
    """Pedir una cita inexistente devuelve 404."""
    response = client.get(
        f"/api/v1/workflows/appointments/{uuid.uuid4()}", headers=TENANT_HEADERS
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "resource.not_found"


# ────────────────────────────────────────────────────────────────────────────
# AUDITORÍA (cross-check)
# ────────────────────────────────────────────────────────────────────────────


def test_checkout_is_audited(client: TestClient) -> None:
    """Crear un checkout registra la operación en el log de auditoría."""
    _create_checkout(client)
    response = client.get(
        "/api/v1/audit?page_size=100", headers=TENANT_HEADERS
    )
    assert response.status_code == 200
    body = response.json()
    assert body["total"] >= 1
    assert any(
        item["operation"] == "workflow.checkout.create" for item in body["items"]
    )
