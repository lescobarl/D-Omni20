"""Esquemas de la matriz programática PSEO (Fase B).

Modelan el contrato del endpoint
``POST /api/v1/generator/matrix-upload/{campaign_id}``:

- ``template_config``: config base con tokens Jinja de la whitelist (4 tokens:
  ``{{ city }}``, ``{{ service_name }}``, ``{{ service_slug }}``,
  ``{{ offer_price }}``).
- ``rows``: lista de filas de la matriz (una landing por combinación
  ciudad/servicio), máximo 500.
- ``compile``: si se compila cada página resuelta con la plantilla ``pseo``.

La respuesta expone cada página resuelta (config + HTML compilado opcional).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class MatrixRow(BaseModel):
    """Fila de la matriz programática (una landing por ciudad/servicio)."""

    model_config = ConfigDict(extra="forbid")

    city: str = Field(min_length=1, max_length=120)
    service_slug: str = Field(min_length=1, max_length=120)
    service_name: str = Field(min_length=1, max_length=200)
    offer_price: str = Field(min_length=1, max_length=20)


class MatrixUploadRequest(BaseModel):
    """Solicitud de carga de matriz: config base + filas a resolver (≤ 500)."""

    model_config = ConfigDict(extra="forbid")

    template_config: dict[str, Any]
    rows: list[MatrixRow] = Field(min_length=1, max_length=500)
    compile: bool = True


class MatrixPageResult(BaseModel):
    """Página resuelta: datos de la fila + config resuelto (+ HTML compilado)."""

    model_config = ConfigDict(extra="forbid")

    city: str
    service_slug: str
    service_name: str
    offer_price: str
    config: dict[str, Any]
    html: str | None = None


class MatrixUploadResponse(BaseModel):
    """Respuesta del upload: resumen de la matriz + páginas resueltas."""

    model_config = ConfigDict(extra="forbid")

    tenant_id: uuid.UUID
    campaign_id: uuid.UUID
    total_rows: int
    resolved_rows: int
    pages: list[MatrixPageResult]
    compiled_at: datetime | None = None


__all__ = [
    "MatrixRow",
    "MatrixUploadRequest",
    "MatrixPageResult",
    "MatrixUploadResponse",
]
