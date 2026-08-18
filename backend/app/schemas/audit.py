"""Esquema del log de auditoría (lectura)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from app.schemas.common import ORMModel


class AuditLogRead(ORMModel):
    id: uuid.UUID
    tenant_id: uuid.UUID | None
    user_id: str | None
    request_id: str
    operation: str
    entity_type: str | None
    entity_id: str | None
    details: dict[str, Any]
    created_at: datetime
