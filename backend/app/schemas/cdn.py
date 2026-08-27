"""Esquemas de despliegue al CDN (Fase 10)."""

from __future__ import annotations

import uuid
from datetime import datetime

from app.schemas.common import ORMModel


class CdnDeployResponse(ORMModel):
    """Respuesta de un despliegue de una landing al CDN (URL versionada)."""

    id: uuid.UUID
    landing_id: uuid.UUID
    version: int
    url: str
    status: str
    deployed_at: datetime
    created_at: datetime
