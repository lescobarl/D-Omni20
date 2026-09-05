"""Esquemas de landing pages (CRUD + compilación)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import ORMModel


class LandingCreate(BaseModel):
    """Payload para crear una landing dentro del tenant activo."""

    campaign_id: uuid.UUID
    name: str = Field(min_length=1, max_length=255)
    slug: str | None = Field(
        default=None,
        min_length=1,
        max_length=255,
        pattern=r"^[a-z0-9][a-z0-9-]*$",
        description=(
            "URL amigable única dentro del tenant (p. ej. 'casa-vista-lago'). "
            "Si se omite, se genera automáticamente a partir del nombre."
        ),
    )
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
    slug: str
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
    minify: bool = False


class LandingCompileResponse(BaseModel):
    """Resultado de la compilación (HTML renderizado + métrica de duración)."""

    html: str
    compiled_at: datetime
    duration_ms: float


class LandingPublishRequest(BaseModel):
    """Solicitud de (des)publicación de una landing."""

    model_config = ConfigDict(extra="forbid")

    published: bool = True


WorkflowType = Literal[
    "direct_checkout", "lead_capture", "quote_generator", "appointment_scheduler"
]


class LandingAiGenerationRequest(BaseModel):
    """Solicitud de generación IA de una landing (prompt + workflow + voz de marca)."""

    model_config = ConfigDict(extra="forbid")

    prompt: str = Field(min_length=1, max_length=4000)
    workflow_type: WorkflowType | None = None
    brand_voice: dict[str, Any] | None = None


class LandingAiGenerationResponse(BaseModel):
    """Respuesta de generación IA: configuración generada + metadatos (caché/uso)."""

    config: dict[str, Any]
    model: str
    cached: bool
    brand_voice: dict[str, Any] | None = None
    prompt_tokens: int = 0
    completion_tokens: int = 0
    generated_at: datetime
