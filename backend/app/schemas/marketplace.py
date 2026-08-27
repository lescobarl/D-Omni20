"""Esquemas del marketplace de templates de landings (Fase 8)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import ORMModel


class MarketplaceTemplateCreateRequest(BaseModel):
    """Payload de alta de un template en el catálogo del marketplace."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=4000)
    category: str = Field(min_length=1, max_length=64)
    config: dict[str, Any]
    thumbnail_url: str | None = Field(default=None, max_length=500)
    is_public: bool = True


class MarketplaceTemplateRead(ORMModel):
    """Plantilla del catálogo tal como se expone al cliente."""

    id: uuid.UUID
    tenant_id: uuid.UUID
    name: str
    description: str | None = None
    category: str
    config: dict[str, Any]
    thumbnail_url: str | None = None
    is_public: bool
    downloads: int
    created_at: datetime


class MarketplaceImportRequest(BaseModel):
    """Importa un template creando una landing en el tenant activo.

    ``campaign_id`` es obligatorio: ``TenantLanding`` no tiene FK a campañas,
    solo una constraint única por tenant+campaña.
    """

    model_config = ConfigDict(extra="forbid")

    campaign_id: uuid.UUID
    name: str | None = Field(default=None, min_length=1, max_length=255)


class MarketplaceImportResponse(BaseModel):
    """Resultado de importar un template: el template y la landing creada."""

    template: MarketplaceTemplateRead
    landing_id: uuid.UUID
