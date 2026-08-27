"""Pruebas de los adaptadores CRM y del emisor con reintentos (FASE 2 del backlog).

Cubre la capa completa de notificación de prospectos a CRM externos:

- :class:`GenericWebhookAdapter` / :class:`HubSpotCrmAdapter` /
  :class:`SalesforceCrmAdapter` / :class:`ZohoCrmAdapter` — formato de payload,
  autenticación Bearer, mapeo de campos y ciclo de vida del cliente HTTP.
- :func:`canonical_lead_fields` / :func:`apply_field_mapping` — payload canónico
  (usa ``lead.metadata``, no ``metadata_json``: corrección del bug latente) y
  mapeo fuente→destino con anidación por puntos.
- :class:`CrmWebhookSender` — reintentos con backoff exponencial y log
  estructurado de los eventos ``crm_skipped`` / ``crm_retry`` / ``crm_sent`` /
  ``crm_http_error`` / ``crm_failed``.
- Validación fail-fast de ``CRM_PROVIDER`` y ``CRM_FIELD_MAPPING_JSON`` en
  :class:`Settings`, y resolución del adaptador por :func:`build_crm_adapter`.

Regla CLAUDE: sin red real — se inyectan clientes HTTP falsos; configuración
vacía = no-op seguro (``False`` / ``crm_skipped``).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

import httpx
import pytest
from pydantic import ValidationError

from app.config.settings import Settings
from app.core.di import build_container
from app.core.errors import ConfigValidationError
from app.core.logging import ILogger
from app.schemas.workflow import LeadRead
from app.services.crm_adapters import (
    GenericWebhookAdapter,
    HubSpotCrmAdapter,
    SalesforceCrmAdapter,
    ZohoCrmAdapter,
    _parse_field_mapping,
    build_crm_adapter,
)
from app.services.crm_interfaces import ICrmAdapter
from app.services.providers import CrmWebhookSender
from app.services.workflow_interfaces import ICrmWebhookSender


# ---------------------------------------------------------------------------
# Dobles de prueba (logger y cliente httpx falsos)
# ---------------------------------------------------------------------------


class _RecordingLogger(ILogger):
    """Logger de prueba que solo acumula eventos (sin E/S)."""

    def __init__(self) -> None:
        self.events: list[tuple[str, str, dict[str, Any]]] = []

    def debug(self, event: str, message: str = "", **fields: Any) -> None:
        self.events.append((event, message, fields))

    def info(self, event: str, message: str = "", **fields: Any) -> None:
        self.events.append((event, message, fields))

    def warning(self, event: str, message: str = "", **fields: Any) -> None:
        self.events.append((event, message, fields))

    def error(self, event: str, message: str = "", **fields: Any) -> None:
        self.events.append((event, message, fields))

    def critical(self, event: str, message: str = "", **fields: Any) -> None:
        self.events.append((event, message, fields))

    def exception(self, event: str, message: str = "", **fields: Any) -> None:
        self.events.append((event, message, fields))


class _FakeResponse:
    """Respuesta HTTP falsa con la superficie que usan los adaptadores."""

    def __init__(self, payload: Any = None, status_code: int = 200) -> None:
        self._payload = payload
        self.status_code = status_code

    def json(self) -> Any:
        return self._payload


class _FakeClient:
    """Cliente httpx falso compatible con ``_HttpCrmAdapter._post_json``.

    Soporta ``post(url, *, headers, json, data, auth)`` y registra cada llamada.
    """

    def __init__(
        self,
        response: _FakeResponse | None = None,
        *,
        error: httpx.HTTPError | None = None,
        responses: list[_FakeResponse] | None = None,
    ) -> None:
        self._response = response
        self._error = error
        self._responses = list(responses or [])
        self.calls: list[dict[str, Any]] = []
        self.closed = False

    def post(
        self,
        url: str,
        *,
        headers: dict[str, str] | None = None,
        json: dict[str, Any] | None = None,
        data: dict[str, Any] | None = None,
        auth: tuple[str, str] | None = None,
    ) -> _FakeResponse:
        self.calls.append(
            {"url": url, "headers": headers, "json": json, "data": data, "auth": auth}
        )
        if self._error is not None:
            raise self._error
        if self._responses:
            return self._responses.pop(0)
        assert self._response is not None
        return self._response

    def close(self) -> None:
        self.closed = True


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _lead() -> LeadRead:
    """Lead canónico de prueba (la clave de metadatos es ``metadata_json``)."""
    now = datetime.now(timezone.utc)
    return LeadRead.model_validate(
        {
            "id": uuid.uuid4(),
            "tenant_id": uuid.uuid4(),
            "name": "Ana Pérez",
            "email": "ana@example.com",
            "phone": "+5215512345678",
            "source": "landing",
            "status": "new",
            "metadata_json": {"campaign": "verano", "utm_source": "facebook"},
            "created_at": now,
            "revision": 1,
            "updated_at": now,
        }
    )


def _event_names(logger: _RecordingLogger) -> list[str]:
    return [event for event, _message, _fields in logger.events]


# ---------------------------------------------------------------------------
# Payload canónico y mapeo de campos
# ---------------------------------------------------------------------------


def test_generic_adapter_payload_uses_metadata_field() -> None:
    """El payload canónico expone ``metadata`` (campo pydantic), no ``metadata_json``."""
    logger = _RecordingLogger()
    client = _FakeClient(response=_FakeResponse({}, status_code=200))
    adapter = GenericWebhookAdapter(
        endpoint_url="https://crm.example.com/hook",
        logger=logger,
        client=client,
    )
    assert adapter.send_lead(lead=_lead()) is True
    payload = client.calls[0]["json"]
    assert payload["metadata"] == {"campaign": "verano", "utm_source": "facebook"}
    assert "metadata_json" not in payload
    assert payload["email"] == "ana@example.com"


def test_field_mapping_renames_and_nests() -> None:
    """El mapeo renombra fuentes y anida destinos con puntos (``a.b.c``)."""
    client = _FakeClient(response=_FakeResponse({}, status_code=200))
    adapter = GenericWebhookAdapter(
        endpoint_url="https://crm.example.com/hook",
        logger=_RecordingLogger(),
        client=client,
        field_mapping={
            "name": "properties.firstname",
            "email": "properties.email",
            "phone": "properties.phone",
            "source": "lead_source",
        },
    )
    adapter.send_lead(lead=_lead())
    payload = client.calls[0]["json"]
    assert payload["properties"] == {
        "firstname": "Ana Pérez",
        "email": "ana@example.com",
        "phone": "+5215512345678",
    }
    assert payload["lead_source"] == "landing"


def test_field_mapping_omits_missing_sources() -> None:
    """Las fuentes ausentes del payload canónico se omiten sin error."""
    client = _FakeClient(response=_FakeResponse({}, status_code=200))
    adapter = GenericWebhookAdapter(
        endpoint_url="https://crm.example.com/hook",
        logger=_RecordingLogger(),
        client=client,
        field_mapping={"campo_inexistente": "ignored.target", "email": "email"},
    )
    adapter.send_lead(lead=_lead())
    payload = client.calls[0]["json"]
    assert "ignored" not in payload
    assert payload["email"] == "ana@example.com"


# ---------------------------------------------------------------------------
# Adaptadores concretos (payload + autenticación)
# ---------------------------------------------------------------------------


def test_hubspot_adapter_envelope_and_bearer() -> None:
    client = _FakeClient(response=_FakeResponse({}, status_code=200))
    adapter = HubSpotCrmAdapter(
        endpoint_url="https://api.hubspot.com/crm/v3/objects/contacts",
        api_token="tok-hubspot",
        logger=_RecordingLogger(),
        client=client,
    )
    assert adapter.provider_name == "hubspot"
    assert isinstance(adapter, ICrmAdapter)
    assert adapter.send_lead(lead=_lead()) is True
    call = client.calls[0]
    assert call["headers"]["Authorization"] == "Bearer tok-hubspot"
    assert call["json"]["properties"]["email"] == "ana@example.com"
    assert call["json"]["properties"]["metadata"] == {
        "campaign": "verano",
        "utm_source": "facebook",
    }


def test_salesforce_adapter_flat_payload_with_bearer() -> None:
    client = _FakeClient(response=_FakeResponse({}, status_code=201))
    adapter = SalesforceCrmAdapter(
        endpoint_url="https://instance.salesforce.com/services/data/v60.0/sobjects/Lead",
        api_token="tok-sf",
        logger=_RecordingLogger(),
        client=client,
    )
    assert adapter.provider_name == "salesforce"
    assert adapter.send_lead(lead=_lead()) is True
    call = client.calls[0]
    assert call["headers"]["Authorization"] == "Bearer tok-sf"
    assert call["json"]["email"] == "ana@example.com"
    assert "properties" not in call["json"]
    assert "data" not in call["json"]


def test_zoho_adapter_data_envelope_with_bearer() -> None:
    client = _FakeClient(response=_FakeResponse({}, status_code=200))
    adapter = ZohoCrmAdapter(
        endpoint_url="https://www.zohoapis.com/crm/v6/Leads",
        api_token="tok-zoho",
        logger=_RecordingLogger(),
        client=client,
    )
    assert adapter.provider_name == "zoho"
    assert adapter.send_lead(lead=_lead()) is True
    call = client.calls[0]
    assert call["headers"]["Authorization"] == "Bearer tok-zoho"
    assert len(call["json"]["data"]) == 1
    assert call["json"]["data"][0]["email"] == "ana@example.com"


def test_adapter_without_token_omits_auth_header() -> None:
    client = _FakeClient(response=_FakeResponse({}, status_code=200))
    adapter = GenericWebhookAdapter(
        endpoint_url="https://crm.example.com/hook",
        logger=_RecordingLogger(),
        client=client,
    )
    adapter.send_lead(lead=_lead())
    call = client.calls[0]
    assert "Authorization" not in call["headers"]
    assert call["headers"]["Content-Type"] == "application/json"


# ---------------------------------------------------------------------------
# Contrato del adaptador (configured / errores)
# ---------------------------------------------------------------------------


def test_adapter_unconfigured_returns_false() -> None:
    adapter = GenericWebhookAdapter(endpoint_url="", logger=_RecordingLogger())
    assert adapter.is_configured() is False
    assert adapter.send_lead(lead=_lead()) is False


def test_adapter_raises_http_status_error_on_500() -> None:
    client = _FakeClient(response=_FakeResponse({}, status_code=500))
    adapter = GenericWebhookAdapter(
        endpoint_url="https://crm.example.com/hook",
        logger=_RecordingLogger(),
        client=client,
    )
    with pytest.raises(httpx.HTTPStatusError) as excinfo:
        adapter.send_lead(lead=_lead())
    assert excinfo.value.response.status_code == 500


def test_adapter_raises_http_error_on_network_failure() -> None:
    client = _FakeClient(error=httpx.ConnectError("connection refused"))
    adapter = GenericWebhookAdapter(
        endpoint_url="https://crm.example.com/hook",
        logger=_RecordingLogger(),
        client=client,
    )
    with pytest.raises(httpx.HTTPError):
        adapter.send_lead(lead=_lead())


def test_close_does_not_close_injected_client() -> None:
    client = _FakeClient(response=_FakeResponse({}, status_code=200))
    adapter = GenericWebhookAdapter(
        endpoint_url="https://crm.example.com/hook",
        logger=_RecordingLogger(),
        client=client,
    )
    adapter.close()
    assert client.closed is False


def test_adapter_lazily_creates_owned_client(monkeypatch) -> None:
    """Sin cliente inyectado, el adaptador crea y cierra su propio cliente."""
    logger = _RecordingLogger()
    fake = _FakeClient(response=_FakeResponse({}, status_code=200))
    monkeypatch.setattr("app.services.crm_adapters.httpx.Client", lambda timeout: fake)
    adapter = GenericWebhookAdapter(
        endpoint_url="https://crm.example.com/hook",
        logger=logger,
    )
    adapter.send_lead(lead=_lead())
    assert len(fake.calls) == 1
    assert fake.closed is False
    adapter.close()
    assert fake.closed is True


# ---------------------------------------------------------------------------
# CrmWebhookSender: backward-compat, no-op y reintentos con backoff
# ---------------------------------------------------------------------------


def test_sender_unconfigured_returns_false_and_logs_skipped() -> None:
    logger = _RecordingLogger()
    sender = CrmWebhookSender(webhook_url="", logger=logger, retry_backoff_seconds=0.0)
    assert sender.send_lead(lead=_lead()) is False
    assert "workflow.lead.crm_skipped" in _event_names(logger)


def test_sender_default_adapter_uses_generic_flat_payload() -> None:
    """Sin ``adapter`` explícito se construye un adaptador genérico (backward-compat)."""
    logger = _RecordingLogger()
    client = _FakeClient(response=_FakeResponse({}, status_code=200))
    sender = CrmWebhookSender(
        webhook_url="https://crm.example.com/hook",
        logger=logger,
        client=client,
        retry_backoff_seconds=0.0,
    )
    assert sender.send_lead(lead=_lead()) is True
    assert len(client.calls) == 1
    payload = client.calls[0]["json"]
    assert payload["email"] == "ana@example.com"
    assert payload["metadata"] == {"campaign": "verano", "utm_source": "facebook"}
    assert "workflow.lead.crm_sent" in _event_names(logger)
    sent = [e for e in logger.events if e[0] == "workflow.lead.crm_sent"][0]
    assert sent[2]["attempt"] == 1
    assert sent[2]["provider"] == "generic"


def test_retry_success_with_exponential_backoff(monkeypatch) -> None:
    """500 → 500 → 200: reintenta con ``backoff * 2 ** (attempt - 1)`` y entrega."""
    logger = _RecordingLogger()
    client = _FakeClient(
        responses=[
            _FakeResponse({}, status_code=500),
            _FakeResponse({}, status_code=500),
            _FakeResponse({}, status_code=200),
        ]
    )
    delays: list[float] = []
    monkeypatch.setattr(
        "app.services.providers.time.sleep", lambda seconds: delays.append(seconds)
    )
    sender = CrmWebhookSender(
        webhook_url="https://crm.example.com/hook",
        logger=logger,
        client=client,
        retry_max_attempts=3,
        retry_backoff_seconds=0.01,
    )
    assert sender.send_lead(lead=_lead()) is True
    assert len(client.calls) == 3
    assert delays == [0.01, 0.02]
    assert _event_names(logger).count("workflow.lead.crm_retry") == 2
    sent = [e for e in logger.events if e[0] == "workflow.lead.crm_sent"][0]
    assert sent[2]["attempt"] == 3


def test_retry_exhausted_http_error_logs_final(monkeypatch) -> None:
    """500 × 3: agota los intentos y registra ``crm_http_error`` con el status."""
    logger = _RecordingLogger()
    client = _FakeClient(
        responses=[_FakeResponse({}, status_code=500) for _ in range(3)]
    )
    delays: list[float] = []
    monkeypatch.setattr(
        "app.services.providers.time.sleep", lambda seconds: delays.append(seconds)
    )
    sender = CrmWebhookSender(
        webhook_url="https://crm.example.com/hook",
        logger=logger,
        client=client,
        retry_max_attempts=3,
        retry_backoff_seconds=0.01,
    )
    assert sender.send_lead(lead=_lead()) is False
    assert len(client.calls) == 3
    final = [e for e in logger.events if e[0] == "workflow.lead.crm_http_error"]
    assert len(final) == 1
    assert final[0][2]["status_code"] == 500
    assert final[0][2]["attempt"] == 3
    assert "workflow.lead.crm_retry" in _event_names(logger)


def test_retry_exhausted_network_error_logs_final(monkeypatch) -> None:
    """Error de red persistente: agota los intentos y registra ``crm_failed``."""
    logger = _RecordingLogger()
    client = _FakeClient(error=httpx.ConnectError("connection refused"))
    delays: list[float] = []
    monkeypatch.setattr(
        "app.services.providers.time.sleep", lambda seconds: delays.append(seconds)
    )
    sender = CrmWebhookSender(
        webhook_url="https://crm.example.com/hook",
        logger=logger,
        client=client,
        retry_max_attempts=3,
        retry_backoff_seconds=0.01,
    )
    assert sender.send_lead(lead=_lead()) is False
    assert len(client.calls) == 3
    final = [e for e in logger.events if e[0] == "workflow.lead.crm_failed"]
    assert len(final) == 1
    assert "connection refused" in final[0][2]["cause"]
    assert final[0][2]["attempt"] == 3


# ---------------------------------------------------------------------------
# Fábrica de adaptadores (build_crm_adapter)
# ---------------------------------------------------------------------------


def test_build_crm_adapter_resolves_each_provider() -> None:
    cases = [
        ("generic", "https://hook.example.com", GenericWebhookAdapter),
        ("hubspot", "https://hub.example.com", HubSpotCrmAdapter),
        ("salesforce", "https://sf.example.com", SalesforceCrmAdapter),
        ("zoho", "https://zoho.example.com", ZohoCrmAdapter),
    ]
    for provider, url, expected_cls in cases:
        settings = Settings(
            database_url="sqlite:///x.db",
            crm_provider=provider,
            crm_webhook_url=url,
        )
        adapter = build_crm_adapter(settings=settings, logger=_RecordingLogger())
        assert isinstance(adapter, expected_cls)
        assert isinstance(adapter, ICrmAdapter)
        assert adapter.provider_name == provider


def test_build_crm_adapter_falls_back_to_webhook_url() -> None:
    """Sin URL específica del proveedor, el adaptador cae al webhook genérico."""
    settings = Settings(
        database_url="sqlite:///x.db",
        crm_provider="hubspot",
        crm_webhook_url="https://hook.example.com",
    )
    adapter = build_crm_adapter(settings=settings, logger=_RecordingLogger())
    assert adapter._endpoint_url == "https://hook.example.com"


def test_build_crm_adapter_raises_config_error_on_invalid_mapping() -> None:
    """Settings fail-fast ya rechaza el JSON inválido; el error de contexto vive
    en ``_parse_field_mapping`` (invocado por ``build_crm_adapter``)."""
    settings = Settings(
        database_url="sqlite:///x.db",
        crm_provider="generic",
        crm_field_mapping_json="",
    )
    adapter = build_crm_adapter(settings=settings, logger=_RecordingLogger())
    assert isinstance(adapter, GenericWebhookAdapter)
    with pytest.raises(ConfigValidationError):
        _parse_field_mapping("esto no es json")
    with pytest.raises(ConfigValidationError):
        _parse_field_mapping('{"name": 42}')


# ---------------------------------------------------------------------------
# Validación fail-fast de Settings
# ---------------------------------------------------------------------------


def test_settings_accepts_valid_crm_config() -> None:
    settings = Settings(
        database_url="sqlite:///x.db",
        crm_provider="HUBSPOT",
        crm_field_mapping_json='{"name": "properties.firstname"}',
        crm_retry_max_attempts=5,
    )
    assert settings.crm_provider == "hubspot"
    assert settings.crm_retry_max_attempts == 5
    assert settings.crm_field_mapping_json == '{"name": "properties.firstname"}'


def test_settings_rejects_invalid_crm_provider() -> None:
    with pytest.raises(ValidationError):
        Settings(database_url="sqlite:///x.db", crm_provider="oracle")


def test_settings_rejects_invalid_crm_mapping_json() -> None:
    with pytest.raises(ValidationError):
        Settings(database_url="sqlite:///x.db", crm_field_mapping_json="no es json")


def test_settings_rejects_non_string_mapping_values() -> None:
    with pytest.raises(ValidationError):
        Settings(database_url="sqlite:///x.db", crm_field_mapping_json='{"a": 1}')


# ---------------------------------------------------------------------------
# Integración con el contenedor DI
# ---------------------------------------------------------------------------


def test_container_crm_webhook_sender_uses_generic_adapter(test_settings) -> None:
    """El contenedor resuelve el emisor con el adaptador activo (por defecto generic)."""
    container = build_container(test_settings)
    try:
        sender = container.crm_webhook_sender
        assert isinstance(sender, ICrmWebhookSender)
        assert sender._adapter.provider_name == "generic"
    finally:
        container.dispose()
