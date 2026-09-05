"""Esquemas de páginas del Portal del Cliente (CRUD + generación IA)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import ORMModel


class PortalPageCreate(BaseModel):
    """Payload para crear una página del portal dentro del tenant activo."""

    slug: str = Field(min_length=1, max_length=255, pattern=r"^[a-z0-9-]+$")
    title: str = Field(min_length=1, max_length=255)
    blocks: dict[str, Any] = Field(default_factory=dict)


class PortalPageUpdate(BaseModel):
    """Payload parcial para actualizar una página del portal (PATCH semantics)."""

    model_config = ConfigDict(extra="forbid")

    slug: str | None = Field(default=None, min_length=1, max_length=255, pattern=r"^[a-z0-9-]+$")
    title: str | None = Field(default=None, min_length=1, max_length=255)
    blocks: dict[str, Any] | None = None
    published: bool | None = None


class PortalPageRead(ORMModel):
    """Página del portal tal como se expone a los clientes."""

    id: uuid.UUID
    tenant_id: uuid.UUID
    slug: str
    title: str
    blocks: dict[str, Any]
    compiled_html: str | None
    published: bool
    published_at: datetime | None
    created_at: datetime
    revision: int
    updated_at: datetime


class PortalPagePublishRequest(BaseModel):
    """Solicitud de (des)publicación de una página del portal."""

    model_config = ConfigDict(extra="forbid")

    published: bool = True


class PortalPageAiGenerationRequest(BaseModel):
    """Solicitud de generación IA de una página del portal (prompt + voz de marca)."""

    model_config = ConfigDict(extra="forbid")

    prompt: str = Field(min_length=1, max_length=4000)
    brand_voice: dict[str, Any] | None = None


class PortalPageAiGenerationResponse(BaseModel):
    """Respuesta de generación IA: página generada + metadatos (caché/uso)."""

    slug: str
    title: str
    blocks: dict[str, Any]
    model: str
    cached: bool
    brand_voice: dict[str, Any] | None = None
    prompt_tokens: int = 0
    completion_tokens: int = 0
    generated_at: datetime
