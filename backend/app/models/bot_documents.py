"""Modelos de la ingesta de base de conocimiento (Fase 1 — RAG).

``BotDocument`` representa una fuente ingerida (PDF, TXT, CSV o URL) con su
texto extraído y metadatos. ``BotDocumentChunk`` guarda los fragmentos del
documento (con ``ordinal``) para permitir búsqueda granular.

Reglas CLAUDE aplicadas: UUIDv4, tupla sync ``[revision, updated_at, deleted]``,
soft-delete y aislamiento multi-tenant por ``tenant_id``.
"""

from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, Integer, String, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import (
    Base,
    JSONType,
    SyncTupleMixin,
    TenantScopedMixin,
    TimestampsMixin,
    UUIDPrimaryKeyMixin,
)


class BotDocument(Base, UUIDPrimaryKeyMixin, TimestampsMixin, SyncTupleMixin, TenantScopedMixin):
    """Documento de conocimiento ingerido por el tenant (PDF/TXT/CSV/URL)."""

    __tablename__ = "bot_documents"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    source_type: Mapped[str] = mapped_column(String(16), nullable=False)
    source_ref: Mapped[str | None] = mapped_column(String(512), nullable=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    metadata_json: Mapped[dict] = mapped_column("metadata", JSONType, nullable=False, default=dict)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)


class BotDocumentChunk(Base, UUIDPrimaryKeyMixin, TimestampsMixin, SyncTupleMixin, TenantScopedMixin):
    """Fragmento de un documento para búsqueda granular (Fase 1 — RAG)."""

    __tablename__ = "bot_document_chunks"
    __table_args__ = (
        UniqueConstraint("document_id", "ordinal", name="uq_bot_document_chunks_document_ordinal"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    document_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("bot_documents.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
