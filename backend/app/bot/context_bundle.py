"""Cliente del context bundle del bot (Fase 3).

El bot NO consulta la base de la plataforma directamente: solicita a la API
m2m de OmniBotIA el bundle de contexto de la empresa para un canal
(``GET /api/v1/bot/context/{channel_id}``), que incluye:

- Credenciales del canal descifradas por request (solo en memoria).
- ``prompt_base`` derivado de ``brand_voice`` + contenido + catálogo.
- Proveedores de IA configurados para la empresa.
"""

from __future__ import annotations

import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

import httpx

from app.bot.interfaces import ProviderConfig
from app.core.errors import DependencyError
from app.core.logging import ILogger


@dataclass(frozen=True)
class CompanyContextBundle:
    """Bundle de contexto de la empresa resuelto por la plataforma."""

    tenant_id: uuid.UUID
    channel_id: uuid.UUID
    channel_type: str
    phone_number_id: str | None = None
    access_token: str = ""
    webhook_secret: str = ""
    prompt_base: str = ""
    providers: tuple[ProviderConfig, ...] = ()
    content_items: tuple[dict[str, Any], ...] = ()
    catalog_items: tuple[dict[str, Any], ...] = ()


class IContextBundleClient(ABC):
    """Puerto del cliente del context bundle (DI: el bot nunca usa ``new``)."""

    @abstractmethod
    def fetch(self, *, channel_id: uuid.UUID) -> CompanyContextBundle:
        """Obtiene el bundle de contexto para un canal."""

    @abstractmethod
    def close(self) -> None:
        """Cierra recursos subyacentes (sesión HTTP)."""


class HttpContextBundleClient(IContextBundleClient):
    """Cliente HTTP m2m del context bundle contra la API de OmniBotIA."""

    def __init__(
        self,
        *,
        base_url: str,
        service_credential: str,
        timeout_seconds: float = 10.0,
        logger: ILogger,
    ) -> None:
        self._logger = logger
        self._client = httpx.Client(
            base_url=base_url.rstrip("/"),
            timeout=httpx.Timeout(timeout_seconds),
            headers={"Authorization": f"Bearer {service_credential}"},
        )

    def fetch(self, *, channel_id: uuid.UUID) -> CompanyContextBundle:
        try:
            response = self._client.get(f"/api/v1/bot/context/{channel_id}")
            response.raise_for_status()
        except httpx.HTTPError as exc:
            self._logger.error(
                "bot.context.fetch_failed",
                "No se pudo resolver el context bundle",
                channel_id=str(channel_id),
                error=str(exc),
            )
            raise DependencyError(
                "Context bundle no disponible",
                operation="bot.context.fetch",
                context={"channel_id": str(channel_id)},
                cause=exc,
            ) from exc
        return self._parse_bundle(response.json())

    def _parse_bundle(self, payload: dict[str, Any]) -> CompanyContextBundle:
        providers = tuple(
            ProviderConfig(
                provider_id=uuid.UUID(str(item["provider_id"])),
                provider_kind=str(item["provider_kind"]),
                order=int(item["order"]),
                enabled=bool(item["enabled"]),
                model=item.get("model"),
                temperature=(
                    Decimal(str(item["temperature"])) if item.get("temperature") is not None else None
                ),
                prompt_base=str(item.get("prompt_base", "")),
                api_key=str(item.get("api_key", "")),
            )
            for item in payload.get("providers", [])
        )
        return CompanyContextBundle(
            tenant_id=uuid.UUID(str(payload["tenant_id"])),
            channel_id=uuid.UUID(str(payload["channel_id"])),
            channel_type=str(payload.get("channel_type", "whatsapp")),
            phone_number_id=payload.get("phone_number_id"),
            access_token=str(payload.get("access_token", "")),
            webhook_secret=str(payload.get("webhook_secret", "")),
            prompt_base=str(payload.get("prompt_base", "")),
            providers=providers,
            content_items=tuple(payload.get("content_items", [])),
            catalog_items=tuple(payload.get("catalog_items", [])),
        )

    def close(self) -> None:
        self._client.close()
