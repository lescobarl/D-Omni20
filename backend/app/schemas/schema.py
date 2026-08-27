"""Esquemas de JSON Schemas (Draft 2020-12) del editor visual."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import ORMModel


class SchemaGenerateRequest(BaseModel):
    """Petición para generar un JSON Schema con IA (DeepSeek)."""

    model_config = ConfigDict(extra="forbid")

    prompt: str = Field(min_length=1, max_length=4000)
    name: str | None = Field(default=None, min_length=1, max_length=255)


class SchemaGenerateResponse(BaseModel):
    """Respuesta de la generación IA de un JSON Schema."""

    schema: dict[str, Any]
    model: str
    cached: bool
    prompt_tokens: int = 0
    completion_tokens: int = 0
    generated_at: datetime


class DeveloperSchemaRead(ORMModel):
    """JSON Schema persistido tal como se expone a los clientes."""

    id: uuid.UUID
    tenant_id: uuid.UUID
    name: str
    description: str | None = None
    schema_json: dict[str, Any]
    version: str
    created_at: datetime
    revision: int
    updated_at: datetime


class SchemaVersionCreateRequest(BaseModel):
    """Petición para crear una nueva versión de un JSON Schema.

    Si ``schema_json`` no se envía, se congela el ``schema_json`` actual del
    schema padre como snapshot (el endpoint aplica el valor por defecto).
    """

    model_config = ConfigDict(extra="forbid")

    version: str = Field(min_length=1, max_length=32)
    schema_json: dict[str, Any] | None = None
    change_note: str | None = Field(default=None, max_length=2000)


class SchemaVersionRead(ORMModel):
    """Snapshot versionado de un JSON Schema, expuesto a los clientes."""

    id: uuid.UUID
    tenant_id: uuid.UUID
    schema_id: uuid.UUID
    version: str
    schema_json: dict[str, Any]
    change_note: str | None = None
    created_at: datetime


class SchemaValidationIssue(BaseModel):
    """Incumplimiento detectado al validar un JSON Schema o datos contra él."""

    path: str
    message: str
    keyword: str | None = None


class SchemaValidateRequest(BaseModel):
    """Petición para validar un JSON Schema (Draft 2020-12) y, opcionalmente, datos."""

    model_config = ConfigDict(extra="forbid")

    schema: dict[str, Any]
    data: dict[str, Any] | None = None


class SchemaValidateResponse(BaseModel):
    """Respuesta de la validación de un JSON Schema (Draft 2020-12)."""

    valid: bool
    errors: int
    issues: list[SchemaValidationIssue]
