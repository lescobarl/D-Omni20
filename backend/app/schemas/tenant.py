"""Esquemas del tenant (contrato público de la API)."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel


class TenantCreate(BaseModel):
    """Payload para crear un tenant."""

    slug: str = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9][a-z0-9-]*$")
    name: str = Field(min_length=1, max_length=255)


class TenantUpdate(BaseModel):
    """Payload para actualizar un tenant (solo el nombre; el slug es inmutable)."""

    name: str | None = Field(default=None, min_length=1, max_length=255)


class TenantRead(ORMModel):
    """Tenant tal como se expone a los clientes."""

    id: uuid.UUID
    slug: str
    name: str
    created_at: datetime
    revision: int
    updated_at: datetime
