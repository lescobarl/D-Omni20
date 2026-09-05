"""Servicio de contexto de empresa del bot (Fase 5 — M1/R1/D1).

El :class:`ContextBundleService` corre en **contexto de servicio** (nunca una
sesión de tenant): resuelve canal → tenant ANTES de leer la base, fija el tenant
con ``SET LOCAL app.current_tenant_id`` dentro de la transacción (transaction-
scoped, se auto-restaura al terminar — equivalente al ``finally`` del plan) y
expone los secretos descifrados únicamente en memoria por request.

Contrato de salida: :class:`CompanyContextBundle`, idéntico al que el bot recibe
vía :meth:`HttpContextBundleClient._parse_bundle` (ver :mod:`app.bot.context_bundle`).
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from decimal import Decimal, InvalidOperation
from typing import Any

from app.bot.context_bundle import CompanyContextBundle
from app.bot.interfaces import ProviderConfig
from app.bot.repositories import SqlAlchemyBotProviderRepository
from app.core.database import Database
from app.core.encryption import TokenCipher
from app.core.errors import NotFoundError
from app.core.logging import ILogger
from app.core.tenancy import set_app_current_tenant
from app.repositories.sqlalchemy_repositories import (
    SqlAlchemyCatalogItemRepository,
    SqlAlchemyContentItemRepository,
    SqlAlchemyTenantChannelRepository,
)

# Tamaño máximo del bundle de contenido/catálogo por request (paginación interna).
_BUNDLE_PAGE_SIZE = 1000


def _format_price(price: Any, currency: str = "MXN") -> str:
    """Formatea un precio de forma tolerante (Decimal → 2 decimales + moneda)."""
    try:
        return f"{Decimal(str(price)):.2f} {currency}"
    except (ValueError, TypeError, InvalidOperation):
        return f"{price} {currency}"


def _derive_prompt_base(
    content_items: Sequence[dict[str, Any]], catalog_items: Sequence[dict[str, Any]]
) -> str:
    """Deriva el ``prompt_base`` de respaldo del bundle desde contenido y catálogo.

    Grounding equivalente a :meth:`LlmResponseProvider._build_system_prompt`
    (:mod:`app.bot.providers.llm_provider`): cada contenido aporta una línea
    ``- {title}: {content}`` y cada producto una línea ``- {name} ({sku}): {price}``.
    """
    parts: list[str] = [
        "Eres el asistente virtual de esta empresa. Responde siempre en español, "
        "con tono amable y profesional, usando únicamente la información "
        "proporcionada. Si no conoces la respuesta, indícalo con honestidad."
    ]
    for item in content_items:
        title = item.get("title") or item.get("question") or ""
        content = item.get("content") or item.get("answer") or ""
        if title:
            parts.append(f"- {title}: {content}")
    for item in catalog_items:
        name = item.get("name", "")
        sku = item.get("sku", "")
        price = item.get("price")
        suffix = f" ({sku})" if sku else ""
        price_part = ""
        if price is not None:
            price_part = f": {_format_price(price, str(item.get("currency") or "MXN"))}"
        parts.append(f"- {name}{suffix}{price_part}")
    return "\n".join(parts)


class ContextBundleService:
    """Resuelve el bundle de contexto de una empresa para un canal (m2m)."""

    def __init__(
        self,
        *,
        database: Database,
        cipher: TokenCipher | None,
        logger: ILogger,
    ) -> None:
        self._database = database
        self._cipher = cipher
        self._logger = logger

    def get_bundle(self, *, channel_id: uuid.UUID) -> CompanyContextBundle:
        """Construye el bundle de la empresa asociada a un canal.

        Flujo (regla CLAUDE RLS): contexto de servicio (sin tenant) → resolución
        canal → tenant vía ``resolve_by_channel_id`` → fija el GUC del tenant con
        ``SET LOCAL`` (transaction-scoped) → lecturas tenant-scoped. Los secretos
        descifrados viven solo en el bundle devuelto (memoria por request).
        """
        with self._database.session_scope() as session:
            channel_repo = SqlAlchemyTenantChannelRepository(session, cipher=self._cipher)
            channel = channel_repo.resolve_by_channel_id(channel_id=channel_id)
            if channel is None:
                self._logger.warning(
                    "bot.context.channel_not_found",
                    "Canal no encontrado o deshabilitado",
                    channel_id=str(channel_id),
                )
                raise NotFoundError(
                    "Canal no encontrado o deshabilitado",
                    operation="bot.context.resolve",
                    context={"channel_id": str(channel_id)},
                )

            tenant_id = channel.tenant_id
            # Fija el tenant de la transacción (``SET LOCAL`` transaction-scoped →
            # se auto-restaura al terminar la sesión, equivalente al ``finally``).
            set_app_current_tenant(session.connection(), str(tenant_id))

            content_repo = SqlAlchemyContentItemRepository(session)
            catalog_repo = SqlAlchemyCatalogItemRepository(session)
            provider_repo = SqlAlchemyBotProviderRepository(session)

            content_rows, _ = content_repo.list(
                tenant_id=tenant_id, page=1, page_size=_BUNDLE_PAGE_SIZE
            )
            catalog_rows, _ = catalog_repo.list(
                tenant_id=tenant_id, page=1, page_size=_BUNDLE_PAGE_SIZE
            )
            provider_rows = provider_repo.list(tenant_id=tenant_id)

            content_items = tuple(
                {
                    "kind": row.kind,
                    "title": row.title,
                    "content": row.content,
                    "tags": row.tags or [],
                }
                for row in content_rows
            )
            catalog_items = tuple(
                {
                    "sku": row.sku,
                    "name": row.name,
                    "description": row.description or "",
                    "price": str(row.price),
                    "currency": row.currency,
                    "available": row.available,
                    "metadata": row.metadata_json or {},
                }
                for row in catalog_rows
            )
            providers = tuple(
                ProviderConfig(
                    provider_id=row.id,
                    provider_kind=row.provider_kind,
                    order=row.order,
                    enabled=row.enabled,
                    model=row.model,
                    temperature=row.temperature,
                    prompt_base=row.prompt_base or "",
                    api_key=row.api_key or row.api_key_ref,
                )
                for row in provider_rows
            )

            self._logger.info(
                "bot.context.resolved",
                "Bundle de contexto resuelto",
                tenant_id=str(tenant_id),
                channel_id=str(channel_id),
                channel_type=channel.channel_type,
                content_items=len(content_items),
                catalog_items=len(catalog_items),
                providers=len(providers),
            )
            return CompanyContextBundle(
                tenant_id=tenant_id,
                channel_id=channel_id,
                channel_type=channel.channel_type,
                phone_number_id=channel.phone_number_id,
                access_token=channel.access_token,
                webhook_secret=channel.webhook_secret,
                prompt_base=_derive_prompt_base(content_items, catalog_items),
                providers=providers,
                content_items=content_items,
                catalog_items=catalog_items,
            )
