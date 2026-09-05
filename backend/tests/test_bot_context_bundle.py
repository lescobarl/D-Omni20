"""Pruebas del cliente del context bundle del bot (Fase 3).

Cubren el cliente HTTP m2m (:class:`HttpContextBundleClient`):
- parseo del bundle (UUIDs, ``Decimal`` de temperatura, proveedores y defaults),
- URL de fetch correcta,
- errores HTTP y de red → :class:`DependencyError` con log estructurado.

Se usa un cliente ``httpx`` falso vía ``monkeypatch`` para evitar red.
"""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Any

import httpx
import pytest

from app.bot.context_bundle import CompanyContextBundle, HttpContextBundleClient
from app.bot.interfaces import ProviderConfig
from app.core.errors import DependencyError


class FakeLogger:
    """Logger en memoria que captura los eventos estructurados."""

    def __init__(self) -> None:
        self.events: list[tuple[str, str, dict[str, Any]]] = []

    def error(self, event: str, message: str = "", **fields: Any) -> None:
        self.events.append((event, message, dict(fields)))


class StubResponse:
    """Respuesta HTTP mínima (código de estado + cuerpo JSON)."""

    def __init__(self, status_code: int, payload: dict[str, Any] | None = None) -> None:
        self.status_code = status_code
        self._payload = payload or {}

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            request = httpx.Request("GET", "http://omni2.test/api/v1/bot/context/x")
            raise httpx.HTTPStatusError(
                f"HTTP {self.status_code}",
                request=request,
                response=httpx.Response(self.status_code, request=request),
            )

    def json(self) -> dict[str, Any]:
        return self._payload


class StubHttpClient:
    """Cliente HTTP falso que devuelve una respuesta o lanza un error de red."""

    def __init__(self, response: StubResponse | None = None, network_error: Exception | None = None) -> None:
        self.response = response
        self.network_error = network_error
        self.requested_url: str | None = None
        self.closed = False

    def get(self, url: str) -> StubResponse:
        self.requested_url = url
        if self.network_error is not None:
            raise self.network_error
        return self.response  # type: ignore[return-value]

    def close(self) -> None:
        self.closed = True


def _build_client(
    monkeypatch: pytest.MonkeyPatch,
    stub: StubHttpClient,
    *,
    service_credential: str = "svc-credential",
) -> HttpContextBundleClient:
    """Construye el cliente con un ``httpx.Client`` falso (sin red)."""

    class _PatchedClient:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            self._stub = stub

        def get(self, url: str) -> StubResponse:
            return self._stub.get(url)

        def close(self) -> None:
            self._stub.close()

    monkeypatch.setattr(httpx, "Client", _PatchedClient)
    return HttpContextBundleClient(
        base_url="http://omni2.test/",
        service_credential=service_credential,
        timeout_seconds=5.0,
        logger=FakeLogger(),
    )


def _payload(channel_id: uuid.UUID, tenant_id: uuid.UUID) -> dict[str, Any]:
    return {
        "tenant_id": str(tenant_id),
        "channel_id": str(channel_id),
        "channel_type": "whatsapp",
        "phone_number_id": "123456789",
        "access_token": "token-secreto",
        "webhook_secret": "webhook-secret",
        "prompt_base": "Eres el asistente de la empresa.",
        "providers": [
            {
                "provider_id": str(uuid.uuid4()),
                "provider_kind": "llm",
                "order": 1,
                "enabled": True,
                "model": "deepseek-chat",
                "temperature": "0.7",
                "prompt_base": "prompt-extra",
                "api_key": "llave-llm",
            },
            {
                "provider_id": str(uuid.uuid4()),
                "provider_kind": "local",
                "order": 2,
                "enabled": False,
                "model": None,
                "temperature": None,
            },
        ],
        "content_items": [{"kind": "faq", "question": "¿Cómo se paga?"}],
        "catalog_items": [{"sku": "A1", "name": "Producto demo"}],
    }


def test_fetch_parses_bundle(monkeypatch: pytest.MonkeyPatch) -> None:
    channel_id = uuid.uuid4()
    tenant_id = uuid.uuid4()
    stub = StubHttpClient(StubResponse(200, _payload(channel_id, tenant_id)))
    client = _build_client(monkeypatch, stub)

    bundle = client.fetch(channel_id=channel_id)

    assert stub.requested_url == f"/api/v1/bot/context/{channel_id}"
    assert isinstance(bundle, CompanyContextBundle)
    assert bundle.tenant_id == tenant_id
    assert bundle.channel_id == channel_id
    assert bundle.channel_type == "whatsapp"
    assert bundle.phone_number_id == "123456789"
    assert bundle.access_token == "token-secreto"
    assert bundle.webhook_secret == "webhook-secret"
    assert bundle.prompt_base == "Eres el asistente de la empresa."
    assert len(bundle.providers) == 2

    first = bundle.providers[0]
    assert isinstance(first, ProviderConfig)
    assert first.provider_kind == "llm"
    assert first.order == 1
    assert first.enabled is True
    assert first.model == "deepseek-chat"
    assert first.temperature == Decimal("0.7")
    assert first.api_key == "llave-llm"

    second = bundle.providers[1]
    assert second.provider_kind == "local"
    assert second.temperature is None
    assert second.model is None

    assert bundle.content_items == ({"kind": "faq", "question": "¿Cómo se paga?"},)
    assert bundle.catalog_items == ({"sku": "A1", "name": "Producto demo"},)


def test_parse_bundle_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    channel_id = uuid.uuid4()
    tenant_id = uuid.uuid4()
    payload: dict[str, Any] = {
        "tenant_id": str(tenant_id),
        "channel_id": str(channel_id),
    }
    client = _build_client(monkeypatch, StubHttpClient(StubResponse(200, payload)))

    bundle = client._parse_bundle(payload)

    assert bundle.channel_type == "whatsapp"
    assert bundle.phone_number_id is None
    assert bundle.access_token == ""
    assert bundle.webhook_secret == ""
    assert bundle.prompt_base == ""
    assert bundle.providers == ()
    assert bundle.content_items == ()
    assert bundle.catalog_items == ()


def test_fetch_http_error_raises_dependency_error(monkeypatch: pytest.MonkeyPatch) -> None:
    channel_id = uuid.uuid4()
    stub = StubHttpClient(StubResponse(500, {"error": "boom"}))
    client = _build_client(monkeypatch, stub)

    with pytest.raises(DependencyError) as exc_info:
        client.fetch(channel_id=channel_id)

    error = exc_info.value
    assert error.operation == "bot.context.fetch"
    assert error.context == {"channel_id": str(channel_id)}
    assert "Context bundle no disponible" in str(error)
    assert isinstance(error.cause, httpx.HTTPStatusError)


def test_fetch_network_error_raises_dependency_error(monkeypatch: pytest.MonkeyPatch) -> None:
    channel_id = uuid.uuid4()
    stub = StubHttpClient(network_error=httpx.ConnectError("no hay red"))
    client = _build_client(monkeypatch, stub)

    with pytest.raises(DependencyError):
        client.fetch(channel_id=channel_id)


def test_fetch_error_logs_structured_event(monkeypatch: pytest.MonkeyPatch) -> None:
    channel_id = uuid.uuid4()
    stub = StubHttpClient(StubResponse(503))
    logger = FakeLogger()
    monkeypatch.setattr(
        httpx,
        "Client",
        type(
            "_PatchedClient",
            (),
            {
                "__init__": lambda self, *a, **k: setattr(self, "_stub", stub),
                "get": lambda self, url: self._stub.get(url),
                "close": lambda self: self._stub.close(),
            },
        ),
    )
    client = HttpContextBundleClient(
        base_url="http://omni2.test",
        service_credential="svc-credential",
        timeout_seconds=5.0,
        logger=logger,
    )

    with pytest.raises(DependencyError):
        client.fetch(channel_id=channel_id)

    assert len(logger.events) == 1
    event, message, fields = logger.events[0]
    assert event == "bot.context.fetch_failed"
    assert message == "No se pudo resolver el context bundle"
    assert fields["channel_id"] == str(channel_id)
    assert "error" in fields


def test_close_closes_http_client(monkeypatch: pytest.MonkeyPatch) -> None:
    stub = StubHttpClient(StubResponse(200, {"tenant_id": str(uuid.uuid4()), "channel_id": str(uuid.uuid4())}))
    client = _build_client(monkeypatch, stub)

    client.close()

    assert stub.closed is True
