"""Modelo ``pseo_batches`` — lotes programáticos PSEO persistidos (Fase D).

Cada batch agrupa la compilación de una matriz programática resuelta para una
campaña, identificado de forma idempotente por el hash de la matriz
(``matrix_hash``: contenido del ``template_config`` + filas + versión de
plantilla). Re-ejecutar la misma matriz no genera un batch nuevo.

Incluye la tupla sync ``[revision, updated_at, deleted]`` y el tenant-scoping
RLS (ver mixins de :mod:`app.models.base`).
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import (
    Base,
    SyncTupleMixin,
    TenantScopedMixin,
    TimestampsMixin,
    UUIDPrimaryKeyMixin,
    utcnow,
)


class PseoBatch(Base, UUIDPrimaryKeyMixin, TimestampsMixin, SyncTupleMixin, TenantScopedMixin):
    __tablename__ = "pseo_batches"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    campaign_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        nullable=False,
        index=True,
    )
    matrix_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    template_version: Mapped[str] = mapped_column(String(32), nullable=False)
    page_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="compiled")
    compiled_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utcnow,
    )
