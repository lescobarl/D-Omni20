"""Esquemas de persistencia y serving público PSEO (Fase D)."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, field_validator

from app.schemas.common import ORMModel


class PseoBatchRead(ORMModel):
    """Lote PSEO persistido, idempotente por hash de matriz.

    El hash incluye el contenido de la matriz (config + filas) y la versión de
    plantilla: re-ejecutar el mismo lote sin cambios devuelve el lote existente
    sin generar versiones nuevas de páginas.
    """

    id: uuid.UUID
    tenant_id: uuid.UUID
    campaign_id: uuid.UUID
    matrix_hash: str
    template_version: str
    page_count: int
    status: str
    compiled_at: datetime
    created_at: datetime


class PseoHostRequest(BaseModel):
    """Solicitud de registro de un dominio personalizado del tenant."""

    host: str

    @field_validator("host")
    @classmethod
    def _validate_host(cls, value: str) -> str:
        host = value.strip().lower()
        # Se tolera esquema por ergonomía de entrada, pero no se persiste.
        for scheme in ("https://", "http://"):
            if host.startswith(scheme):
                host = host[len(scheme) :]
        host = host.rstrip("/")
        if not host:
            raise ValueError("El host no puede estar vacío")
        if len(host) > 255:
            raise ValueError("El host no puede superar los 255 caracteres")
        return host


class PseoHostRead(ORMModel):
    """Dominio personalizado del tenant, tal como se expone a los clientes."""

    id: uuid.UUID
    tenant_id: uuid.UUID
    host: str
    status: str
    verify_token: str | None
    verified_at: datetime | None
    created_at: datetime
    updated_at: datetime
    revision: int
    deleted: bool
