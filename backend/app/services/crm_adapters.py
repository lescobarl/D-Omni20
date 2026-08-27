"""Adaptadores CRM concretos (Fase 2 del backlog).

Implementan :class:`ICrmAdapter` sobre ``httpx`` (sin dependencias de terceros
fuera de ``httpx``) para los cuatro destinos soportados:

- :class:`GenericWebhookAdapter` — payload plano a un endpoint webhook.
- :class:`HubSpotCrmAdapter` — envelope ``{"properties": {...}}`` (token privado).
- :class:`SalesforceCrmAdapter` — sObject plano (Bearer de la instancia).
- :class:`ZohoCrmAdapter` — envelope ``{"data": [{...}]}`` (OAuth Bearer).

El *mapeo de campos* renombra/anida claves del payload canónico
(:func:`canonical_lead_fields`) usando destinos con puntos
(ej. ``"campaign": "properties.campaign_origin"``). Fuentes ausentes se omiten;
mapeo vacío = passthrough identidad.

Contrato de :meth:`ICrmAdapter.send_lead`: ``True`` en 2xx, ``False`` si no hay
URL configurada, y lanza ``httpx.HTTPStatusError`` (``status >= 400``) o
``httpx.HTTPError`` (red) para que el emisor reintente con backoff.
"""

from __future__ import annotations

import json
from abc import ABC, abstractmethod
from typing import Any

import httpx

from app.config.settings import Settings
from app.core.errors import ConfigValidationError
from app.core.logging import ILogger
from app.schemas.workflow import LeadRead
from app.services.crm_interfaces import ICrmAdapter


# ---------------------------------------------------------------------------
# Payload canónico y mapeo de campos
# ---------------------------------------------------------------------------


def canonical_lead_fields(lead: LeadRead) -> dict[str, Any]:
    """Construye el dict plano canónico de un lead para enviar a un CRM.

    Usa ``lead.metadata`` (campo pydantic; corrige el bug latente de acceder a
    ``lead.metadata_json``, que no existe como atributo del esquema).
    """
    return {
        "id": str(lead.id),
        "tenant_id": str(lead.tenant_id),
        "name": lead.name,
        "email": lead.email,
        "phone": lead.phone,
        "source": lead.source,
        "status": lead.status,
        "metadata": lead.metadata,
        "created_at": lead.created_at.isoformat(),
    }


def apply_field_mapping(fields: dict[str, Any], mapping: dict[str, str]) -> dict[str, Any]:
    """Aplica un mapeo fuente→destino con anidación por puntos (``a.b.c``).

    - Las fuentes ausentes en ``fields`` se omiten.
    - Un destino con puntos crea un objeto anidado (ej. ``"properties.email"``).
    - ``mapping`` vacío devuelve ``fields`` tal cual (passthrough identidad).
    """
    if not mapping:
        return fields
    result: dict[str, Any] = {}
    for source, target in mapping.items():
        if source not in fields:
            continue
        parts = target.split(".")
        current = result
        for part in parts[:-1]:
            current = current.setdefault(part, {})
        current[parts[-1]] = fields[source]
    return result


def _parse_field_mapping(raw: str) -> dict[str, str]:
    """Parsea el JSON de mapeo de campos desde settings (fail-fast)."""
    stripped = raw.strip()
    if not stripped:
        return {}
    try:
        parsed = json.loads(stripped)
    except json.JSONDecodeError as exc:
        raise ConfigValidationError(
            f"CRM_FIELD_MAPPING_JSON no es JSON válido: {exc}"
        ) from exc
    if not isinstance(parsed, dict) or not all(
        isinstance(k, str) and isinstance(v, str) for k, v in parsed.items()
    ):
        raise ConfigValidationError(
            "CRM_FIELD_MAPPING_JSON debe ser un objeto JSON de string → string "
            '(ej. \'{"campaign": "properties.campaign_origin"}\')'
        )
    return parsed


# ---------------------------------------------------------------------------
# Base HTTP compartida
# ---------------------------------------------------------------------------


class _HttpCrmAdapter(ICrmAdapter, ABC):
    """Base de adaptadores HTTP: headers, mapeo, POST y ciclo de vida del cliente."""

    def __init__(
        self,
        *,
        provider_name: str,
        endpoint_url: str = "",
        api_token: str = "",
        field_mapping: dict[str, str] | None = None,
        timeout_seconds: float = 5.0,
        logger: ILogger,
        client: httpx.Client | None = None,
    ) -> None:
        self._provider_name = provider_name
        self._endpoint_url = endpoint_url
        self._api_token = api_token
        self._field_mapping = field_mapping or {}
        self._timeout_seconds = timeout_seconds
        self._logger = logger
        self._client = client
        self._owns_client = client is None

    # -- ICrmAdapter ---------------------------------------------------------

    @property
    def provider_name(self) -> str:
        return self._provider_name

    def is_configured(self) -> bool:
        return bool(self._endpoint_url.strip())

    def send_lead(self, *, lead: LeadRead) -> bool:
        if not self.is_configured():
            return False
        self._post_json(self._build_payload(lead))
        return True

    def close(self) -> None:
        if self._owns_client and self._client is not None:
            self._client.close()

    # -- Extension points -----------------------------------------------------

    @abstractmethod
    def _build_payload(self, lead: LeadRead) -> dict[str, Any]:
        """Construye el payload específico del CRM (envelope + mapeo)."""

    # -- Helpers --------------------------------------------------------------

    def _get_client(self) -> httpx.Client:
        if self._client is None:
            self._client = httpx.Client(timeout=httpx.Timeout(self._timeout_seconds))
            self._owns_client = True
        return self._client

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if self._api_token:
            headers["Authorization"] = f"Bearer {self._api_token}"
        return headers

    def _mapped_fields(self, lead: LeadRead) -> dict[str, Any]:
        return apply_field_mapping(canonical_lead_fields(lead), self._field_mapping)

    def _post_json(self, payload: dict[str, Any]) -> httpx.Response:
        response = self._get_client().post(
            self._endpoint_url, json=payload, headers=self._headers()
        )
        if response.status_code >= 400:
            request = httpx.Request("POST", self._endpoint_url)
            raise httpx.HTTPStatusError(
                f"CRM {self._provider_name} respondió {response.status_code}",
                request=request,
                response=httpx.Response(response.status_code, request=request),
            )
        return response


# ---------------------------------------------------------------------------
# Adaptadores concretos
# ---------------------------------------------------------------------------


class GenericWebhookAdapter(_HttpCrmAdapter):
    """Payload plano: envía el objeto lead canónico directamente al endpoint."""

    def __init__(
        self,
        *,
        endpoint_url: str = "",
        field_mapping: dict[str, str] | None = None,
        timeout_seconds: float = 5.0,
        logger: ILogger,
        client: httpx.Client | None = None,
    ) -> None:
        super().__init__(
            provider_name="generic",
            endpoint_url=endpoint_url,
            api_token="",
            field_mapping=field_mapping,
            timeout_seconds=timeout_seconds,
            logger=logger,
            client=client,
        )

    def _build_payload(self, lead: LeadRead) -> dict[str, Any]:
        return self._mapped_fields(lead)


class HubSpotCrmAdapter(_HttpCrmAdapter):
    """Envelope HubSpot: ``{"properties": {...}}`` con auth Bearer (token privado)."""

    def __init__(
        self,
        *,
        endpoint_url: str = "",
        api_token: str = "",
        field_mapping: dict[str, str] | None = None,
        timeout_seconds: float = 5.0,
        logger: ILogger,
        client: httpx.Client | None = None,
    ) -> None:
        super().__init__(
            provider_name="hubspot",
            endpoint_url=endpoint_url,
            api_token=api_token,
            field_mapping=field_mapping,
            timeout_seconds=timeout_seconds,
            logger=logger,
            client=client,
        )

    def _build_payload(self, lead: LeadRead) -> dict[str, Any]:
        return {"properties": self._mapped_fields(lead)}


class SalesforceCrmAdapter(_HttpCrmAdapter):
    """sObject plano: payload directo del objeto (Bearer de la instancia)."""

    def __init__(
        self,
        *,
        endpoint_url: str = "",
        api_token: str = "",
        field_mapping: dict[str, str] | None = None,
        timeout_seconds: float = 5.0,
        logger: ILogger,
        client: httpx.Client | None = None,
    ) -> None:
        super().__init__(
            provider_name="salesforce",
            endpoint_url=endpoint_url,
            api_token=api_token,
            field_mapping=field_mapping,
            timeout_seconds=timeout_seconds,
            logger=logger,
            client=client,
        )

    def _build_payload(self, lead: LeadRead) -> dict[str, Any]:
        return self._mapped_fields(lead)


class ZohoCrmAdapter(_HttpCrmAdapter):
    """Envelope Zoho: ``{"data": [{...}]}`` con auth Bearer (OAuth token)."""

    def __init__(
        self,
        *,
        endpoint_url: str = "",
        api_token: str = "",
        field_mapping: dict[str, str] | None = None,
        timeout_seconds: float = 5.0,
        logger: ILogger,
        client: httpx.Client | None = None,
    ) -> None:
        super().__init__(
            provider_name="zoho",
            endpoint_url=endpoint_url,
            api_token=api_token,
            field_mapping=field_mapping,
            timeout_seconds=timeout_seconds,
            logger=logger,
            client=client,
        )

    def _build_payload(self, lead: LeadRead) -> dict[str, Any]:
        return {"data": [self._mapped_fields(lead)]}


# ---------------------------------------------------------------------------
# Fábrica (composition root de adaptadores)
# ---------------------------------------------------------------------------


def build_crm_adapter(*, settings: Settings, logger: ILogger) -> ICrmAdapter:
    """Resuelve el adaptador activo según ``settings.crm_provider``.

    Cada proveedor usa su URL específica si está configurada; en caso contrario
    cae al ``crm_webhook_url`` genérico (compatibilidad con la Fase previa).
    """
    mapping = _parse_field_mapping(settings.crm_field_mapping_json)
    common: dict[str, Any] = {
        "field_mapping": mapping,
        "timeout_seconds": settings.crm_webhook_timeout_seconds,
        "logger": logger,
    }
    provider = settings.crm_provider
    if provider == "hubspot":
        return HubSpotCrmAdapter(
            endpoint_url=settings.crm_hubspot_url or settings.crm_webhook_url,
            api_token=settings.crm_hubspot_token,
            **common,
        )
    if provider == "salesforce":
        return SalesforceCrmAdapter(
            endpoint_url=settings.crm_salesforce_url or settings.crm_webhook_url,
            api_token=settings.crm_salesforce_token,
            **common,
        )
    if provider == "zoho":
        return ZohoCrmAdapter(
            endpoint_url=settings.crm_zoho_url or settings.crm_webhook_url,
            api_token=settings.crm_zoho_token,
            **common,
        )
    return GenericWebhookAdapter(
        endpoint_url=settings.crm_webhook_url,
        **common,
    )
