"""Esquemas de persistencia y serving público PSEO (Fase D)."""

from __future__ import annotations

import uuid
from datetime import datetime

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
