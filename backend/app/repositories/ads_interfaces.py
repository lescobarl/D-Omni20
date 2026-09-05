"""Puertos (ABC) del repositorio de campañas publicitarias (C-1 — eslabón ①).

Regla CLAUDE: la capa de negocio depende de interfaces, no de implementaciones
(inversión de dependencias). Toda operación está SIEMPRE acotada al
``tenant_id`` activo (defensa en profundidad sobre RLS de PostgreSQL).
"""

from __future__ import annotations

import uuid
from abc import ABC, abstractmethod

from app.models.ads import AdCampaign


class IAdsRepository(ABC):
    """Acceso a ``ad_campaigns`` SIEMPRE acotado al tenant.

    La atribución de un lead se resuelve por la firma UTM de la campaña:
    ``resolve_by_utm`` localiza la campaña activa del tenant que coincide con
    ``utm_campaign`` (y, en segundo plano, ``utm_source``/``utm_medium``).
    """

    @abstractmethod
    def create(
        self,
        *,
        tenant_id: uuid.UUID,
        name: str,
        status: str,
        enabled: bool,
        utm_source: str | None,
        utm_medium: str | None,
        utm_campaign: str | None,
        utm_content: str | None,
        utm_term: str | None,
        landing_id: uuid.UUID | None,
        budget_minor: int | None,
        start_at: object | None,
        end_at: object | None,
        notes: str | None,
    ) -> AdCampaign: ...

    @abstractmethod
    def get(
        self, *, tenant_id: uuid.UUID, ad_campaign_id: uuid.UUID
    ) -> AdCampaign | None: ...

    @abstractmethod
    def get_by_name(self, *, tenant_id: uuid.UUID, name: str) -> AdCampaign | None: ...

    @abstractmethod
    def resolve_by_utm(
        self,
        *,
        tenant_id: uuid.UUID,
        utm_campaign: str | None,
        utm_source: str | None,
        utm_medium: str | None,
    ) -> AdCampaign | None: ...

    @abstractmethod
    def list(
        self, *, tenant_id: uuid.UUID, page: int, page_size: int
    ) -> tuple[list[AdCampaign], int]: ...

    @abstractmethod
    def update(
        self, *, tenant_id: uuid.UUID, ad_campaign_id: uuid.UUID, fields: dict[str, object]
    ) -> AdCampaign | None: ...

    @abstractmethod
    def soft_delete(self, *, tenant_id: uuid.UUID, ad_campaign_id: uuid.UUID) -> bool: ...
