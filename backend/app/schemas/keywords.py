"""Esquemas de keywords con prioridades del bot (Fase 3).

Contrato público de los endpoints ``/bot/keywords`` (regla CLAUDE: schema
público validado). Una keyword asocia un término canónico (único por tenant)
con una respuesta fija, una prioridad (menor número = mayor prioridad) y un
estado habilitado/deshabilitado.

Notas de diseño:
- ``KeywordCreate``/``KeywordUpdate`` usan ``extra="forbid"`` para rechazar
  campos desconocidos (contrato estricto).
- ``KeywordRead`` extiende :class:`ORMModel` y :class:`SyncFields` (tupla sync
  ``[revision, updated_at, deleted]`` para replicación).
- La prioridad es un entero en ``[0, 1000]``; el motor resuelve primero el
  número más bajo (mayor prioridad).
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import ORMModel, SyncFields

# Límites del dominio (contrato público validado).
_MAX_TERM_LENGTH = 255
_MAX_RESPONSE_LENGTH = 2000
_MIN_PRIORITY = 0
_MAX_PRIORITY = 1000


class KeywordCreate(BaseModel):
    """Payload para crear una keyword canónica con respuesta fija."""

    model_config = ConfigDict(extra="forbid")

    term: str = Field(min_length=1, max_length=_MAX_TERM_LENGTH)
    response: str = Field(min_length=1, max_length=_MAX_RESPONSE_LENGTH)
    priority: int = Field(default=100, ge=_MIN_PRIORITY, le=_MAX_PRIORITY)
    enabled: bool = True


class KeywordUpdate(BaseModel):
    """Payload para actualizar una keyword (solo los campos enviados)."""

    model_config = ConfigDict(extra="forbid")

    term: str | None = Field(default=None, min_length=1, max_length=_MAX_TERM_LENGTH)
    response: str | None = Field(default=None, min_length=1, max_length=_MAX_RESPONSE_LENGTH)
    priority: int | None = Field(default=None, ge=_MIN_PRIORITY, le=_MAX_PRIORITY)
    enabled: bool | None = None


class KeywordRead(ORMModel, SyncFields):
    """Keyword tal como se expone a los clientes."""

    id: uuid.UUID
    tenant_id: uuid.UUID
    term: str
    response: str
    priority: int
    enabled: bool
    version: int
    created_at: datetime
