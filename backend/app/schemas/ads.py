"""Esquemas de campañas publicitarias (C-1 — eslabón ① de atribución UTM).

Contrato:
- ``extra="forbid"`` en toda petición (fail-fast ante payloads desconocidos).
- Los parámetros UTM son opcionales pero, al proveerse, se acotan a 255 chars.
- El read model expone la tupla sync (``revision``/``updated_at``) para que el
  cliente pueda sincronizar (regla CLAUDE).
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import ORMModel


class AdCampaignCreate(BaseModel):
    """Payload para crear una campaña publicitaria dentro del tenant activo."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=255)
    status: str = Field(default="active", min_length=1, max_length=32)
    enabled: bool = True
    utm_source: str | None = Field(default=None, max_length=255)
    utm_medium: str | None = Field(default=None, max_length=255)
    utm_campaign: str | None = Field(default=None, max_length=255)
    utm_content: str | None = Field(default=None, max_length=255)
    utm_term: str | None = Field(default=None, max_length=255)
    landing_id: uuid.UUID | None = None
    budget_minor: int | None = Field(default=None, ge=0)
    start_at: datetime | None = None
    end_at: datetime | None = None
    notes: str | None = Field(default=None, max_length=4000)


class AdCampaignUpdate(BaseModel):
    """Payload parcial para actualizar una campaña (PATCH semantics)."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=255)
    status: str | None = Field(default=None, min_length=1, max_length=32)
    enabled: bool | None = None
    utm_source: str | None = Field(default=None, max_length=255)
    utm_medium: str | None = Field(default=None, max_length=255)
    utm_campaign: str | None = Field(default=None, max_length=255)
    utm_content: str | None = Field(default=None, max_length=255)
    utm_term: str | None = Field(default=None, max_length=255)
    landing_id: uuid.UUID | None = None
    budget_minor: int | None = Field(default=None, ge=0)
    start_at: datetime | None = None
    end_at: datetime | None = None
    notes: str | None = Field(default=None, max_length=4000)


class AdCampaignRead(ORMModel):
    """Campaña publicitaria tal como se expone a los clientes."""

    id: uuid.UUID
    tenant_id: uuid.UUID
    name: str
    status: str
    enabled: bool
    utm_source: str | None
    utm_medium: str | None
    utm_campaign: str | None
    utm_content: str | None
    utm_term: str | None
    landing_id: uuid.UUID | None
    budget_minor: int | None
    start_at: datetime | None
    end_at: datetime | None
    notes: str | None
    created_at: datetime
    revision: int
    updated_at: datetime
