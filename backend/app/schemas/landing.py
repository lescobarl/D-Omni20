"""Esquemas de landing pages (CRUD + compilación)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import ORMModel


class LandingCreate(BaseModel):
    """Payload para crear una landing dentro del tenant activo."""

    campaign_id: uuid.UUID
    name: str = Field(min_length=1, max_length=255)
    config: dict[str, Any] = Field(default_factory=dict)


class LandingUpdate(BaseModel):
    """Payload parcial para actualizar una landing (PATCH semantics)."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=255)
    config: dict[str, Any] | None = None
    published: bool | None = None


class LandingRead(ORMModel):
    """Landing tal como se expone a los clientes."""

    id: uuid.UUID
    tenant_id: uuid.UUID
    campaign_id: uuid.UUID
    name: str
    config: dict[str, Any]
    compiled_html: str | None
    published: bool
    published_at: datetime | None
    created_at: datetime
    revision: int
    updated_at: datetime


class LandingCompileRequest(BaseModel):
    """Solicitud de compilación de una configuración (config → HTML)."""

    model_config = ConfigDict(extra="forbid")

    config: dict[str, Any]
    template_name: str = "default"


class LandingCompileResponse(BaseModel):
    """Resultado de la compilación (HTML renderizado)."""

    html: str
    compiled_at: datetime


class LandingPublishRequest(BaseModel):
    """Solicitud de (des)publicación de una landing."""

    model_config = ConfigDict(extra="forbid")

    published: bool = True
