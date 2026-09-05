"""Modelo de sinónimos del bot (Fase 2 — normalización de vocabulario).

``BotSynonym`` asocia un ``term`` canónico (ej. "celular") con su lista de
``synonyms`` (ej. ["móvil", "telefono", "movil"]) para normalizar la entrada
del usuario antes de resolver la intención (Fases 3-4).

Reglas CLAUDE aplicadas: UUIDv4, tupla sync ``[revision, updated_at, deleted]``,
soft-delete y aislamiento multi-tenant por ``tenant_id`` (único por tenant).
"""

from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import (
    Base,
    JSONType,
    SyncTupleMixin,
    TenantScopedMixin,
    TimestampsMixin,
    UUIDPrimaryKeyMixin,
)


class BotSynonym(Base, UUIDPrimaryKeyMixin, TimestampsMixin, SyncTupleMixin, TenantScopedMixin):
    """Sinónimos asociados a un término canónico, únicos por tenant."""

    __tablename__ = "bot_synonyms"
    __table_args__ = (
        UniqueConstraint("tenant_id", "term", name="uq_bot_synonyms_tenant_term"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    term: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    synonyms: Mapped[list[str]] = mapped_column(JSONType, nullable=False, default=list)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
