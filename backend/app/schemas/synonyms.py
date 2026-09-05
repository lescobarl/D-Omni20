"""Esquemas de sinónimos del bot (Fase 2 — normalización de vocabulario).

Contrato público de los endpoints ``/content/synonyms`` (regla CLAUDE: schema
público validado). Un sinónimo agrupa un término canónico (único por tenant)
con la lista de variantes que el bot normaliza hacia ese término durante el
matching de mensajes.

Notas de diseño:
- ``SynonymCreate``/``SynonymUpdate`` usan ``extra="forbid"`` para rechazar
  campos desconocidos (contrato estricto).
- ``SynonymRead`` extiende :class:`ORMModel` y :class:`SyncFields` (tupla sync
  ``[revision, updated_at, deleted]`` para replicación).
- La importación masiva (CSV/JSON) llega como texto crudo en el cuerpo JSON
  (mismo patrón que ``CsvImportRequest`` de operations: sin multipart).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import ORMModel, SyncFields

# Límites del dominio (contrato público validado).
_MAX_TERM_LENGTH = 255
_MAX_SYNONYMS = 200


class SynonymCreate(BaseModel):
    """Payload para crear un término canónico con sus sinónimos."""

    model_config = ConfigDict(extra="forbid")

    term: str = Field(min_length=1, max_length=_MAX_TERM_LENGTH)
    synonyms: list[str] = Field(default_factory=list, max_length=_MAX_SYNONYMS)


class SynonymUpdate(BaseModel):
    """Payload para actualizar un sinónimo (solo los campos enviados)."""

    model_config = ConfigDict(extra="forbid")

    term: str | None = Field(default=None, min_length=1, max_length=_MAX_TERM_LENGTH)
    synonyms: list[str] | None = Field(default=None, max_length=_MAX_SYNONYMS)


class SynonymRead(ORMModel, SyncFields):
    """Sinónimo tal como se expone a los clientes (agrupado por término)."""

    id: uuid.UUID
    tenant_id: uuid.UUID
    term: str
    synonyms: list[str]
    version: int
    created_at: datetime


class SynonymImportRequest(BaseModel):
    """Payload de importación masiva de sinónimos (CSV o JSON en texto crudo).

    El cuerpo llega como JSON con el contenido del archivo en ``content`` (igual
    que ``CsvImportRequest`` de operations: sin multipart). Formato CSV: cabecera
    ``term,synonyms`` donde ``synonyms`` usa ``|`` como separador; formato JSON:
    lista de objetos ``{"term": "...", "synonyms": ["...", ...]}``.
    """

    model_config = ConfigDict(extra="forbid")

    content: str = Field(min_length=1, description="Contenido del archivo CSV o JSON")
    format: Literal["csv", "json"] = "csv"
    delimiter: str = Field(default=",", min_length=1, max_length=1)


class SynonymImportResultRead(BaseModel):
    """Resultado de una importación masiva de sinónimos."""

    model_config = ConfigDict(extra="forbid")

    imported: int = 0
    skipped: int = 0
    failed: int = 0
    errors: list[str] = Field(default_factory=list)
