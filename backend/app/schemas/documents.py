"""Esquemas de la ingesta de base de conocimiento (Fase 1 — RAG).

Contrato público de los endpoints ``/content/ingest-file``, ``/content/ingest-url``
y ``/content/documents`` (regla CLAUDE: schema público validado).

Notas de diseño:
- ``DocumentRead.metadata`` lee el atributo ORM ``metadata_json`` (columna
  ``metadata``) y se serializa como ``metadata`` en el JSON (mismo patrón que
  ``CatalogItemRead`` en ``tenant_config.py``).
- La lectura del contenido completo se ofrece en ``GET /content/documents/{id}``;
  la lista paginada NO incluye ``content`` para mantener la respuesta ligera.
- Los esquemas de lectura extienden :class:`ORMModel` y :class:`SyncFields`
  (tupla sync ``[revision, updated_at, deleted]`` para replicación).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import ORMModel, SyncFields

# Fuentes de conocimiento soportadas por la ingesta (Fase 1).
DocumentSourceType = Literal["pdf", "txt", "csv", "url"]


class DocumentRead(ORMModel, SyncFields):
    """Documento ingerido tal como se expone a los clientes (sin ``content``)."""

    id: uuid.UUID
    tenant_id: uuid.UUID
    title: str
    source_type: str
    source_ref: str | None
    size_bytes: int
    # Lee el atributo ORM ``metadata_json`` (columna ``metadata``) y se
    # serializa como ``metadata`` en el JSON de respuesta.
    metadata: dict[str, Any] = Field(validation_alias="metadata_json", serialization_alias="metadata")
    version: int
    created_at: datetime


class DocumentContentRead(DocumentRead):
    """Documento ingerido con su texto completo extraído (detalle)."""

    content: str


class IngestRequest(BaseModel):
    """Payload para ingerir una URL (``GET``/``POST`` de un recurso remoto)."""

    model_config = ConfigDict(extra="forbid")

    url: str = Field(min_length=1, max_length=2048)
    title: str | None = Field(default=None, min_length=1, max_length=255)


class IngestResultRead(BaseModel):
    """Resultado de una ingestión (archivo o URL)."""

    document: DocumentContentRead
    chunks_created: int = 0
    warnings: list[str] = Field(default_factory=list)


class DocumentSearchRequest(BaseModel):
    """Payload de búsqueda por texto sobre documentos/chunks del tenant."""

    model_config = ConfigDict(extra="forbid")

    query: str = Field(min_length=1, max_length=512)
    limit: int = Field(default=10, ge=1, le=50)


class DocumentSearchResult(BaseModel):
    """Fragmento coincidente de un documento (búsqueda granular)."""

    document_id: uuid.UUID
    title: str
    snippet: str
    score: float = 0.0
