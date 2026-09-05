"""Modelo ``portal_pages`` — página del Portal del Cliente editable por tenant.

El Portal del Cliente (C-3) se compone de múltiples páginas (inicio, misión,
visión, acerca, etc.) configurables por el tenant. Cada página es un conjunto
de bloques (``blocks``) generados por IA o editados manualmente en el
configurador unificado (modo portal del editor de landings).

Campos clave:
- ``tenant_id``: columna de aislamiento RLS (ver :class:`TenantScopedMixin`).
- ``slug``: ruta de la página dentro del portal, única dentro del tenant.
- ``title``: título de la página (usado en navegación y SEO).
- ``blocks``: JSONB de los bloques de la página (diseño del editor).
- ``published`` / ``published_at``: ciclo de vida de publicación.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import (
    Base,
    JSONType,
    SyncTupleMixin,
    TenantScopedMixin,
    TimestampsMixin,
    UUIDPrimaryKeyMixin,
)


class PortalPage(Base, UUIDPrimaryKeyMixin, TimestampsMixin, SyncTupleMixin, TenantScopedMixin):
    __tablename__ = "portal_pages"
    __table_args__ = (
        UniqueConstraint("tenant_id", "slug", name="uq_portal_page_tenant_slug"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    slug: Mapped[str] = mapped_column(String(255), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    blocks: Mapped[dict[str, Any]] = mapped_column(JSONType, nullable=False, default=dict)
    compiled_html: Mapped[str | None] = mapped_column(Text, nullable=True)
    published: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
