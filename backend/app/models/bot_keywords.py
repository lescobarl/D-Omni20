"""Modelo de keywords con prioridades del bot (Fase 3).

``BotKeyword`` asocia un ``term`` canónico (ej. "precio") con una ``response``
fija y un ``priority`` (menor número = mayor prioridad). El motor de conversación
resuelve estas keywords en orden de prioridad antes de delegar en la IA.

Reglas CLAUDE aplicadas: UUIDv4, tupla sync ``[revision, updated_at, deleted]``,
soft-delete y aislamiento multi-tenant por ``tenant_id`` (único por tenant).
"""

from __future__ import annotations

import uuid

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import (
    Base,
    SyncTupleMixin,
    TenantScopedMixin,
    TimestampsMixin,
    UUIDPrimaryKeyMixin,
)


class BotKeyword(Base, UUIDPrimaryKeyMixin, TimestampsMixin, SyncTupleMixin, TenantScopedMixin):
    """Keyword canónica con respuesta fija y prioridad, única por tenant."""

    __tablename__ = "bot_keywords"
    __table_args__ = (
        UniqueConstraint("tenant_id", "term", name="uq_bot_keywords_tenant_term"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    term: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    response: Mapped[str] = mapped_column(Text, nullable=False)
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=100)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
