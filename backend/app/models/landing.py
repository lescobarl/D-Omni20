"""Modelo ``tenant_landings`` — landing page editable por tenant.

Campos clave:
- ``tenant_id``: columna de aislamiento RLS (ver :class:`TenantScopedMixin`).
- ``campaign_id``: identificador de campaña, único dentro del tenant.
- ``slug``: URL amigable de la landing, única dentro del tenant (p. ej.
  ``casa-vista-lago-tequesquitengo``). Se sirve en ``GET /l/{slug}``.
- ``config``: JSONB del diseño (bloques) del editor.
- ``compiled_html``: HTML compilado (cache del compilador).
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


class TenantLanding(Base, UUIDPrimaryKeyMixin, TimestampsMixin, SyncTupleMixin, TenantScopedMixin):
    __tablename__ = "tenant_landings"
    __table_args__ = (
        UniqueConstraint("tenant_id", "campaign_id", name="uq_tenant_landing_campaign"),
        UniqueConstraint("tenant_id", "slug", name="uq_tenant_landing_slug"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    campaign_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    slug: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    config: Mapped[dict[str, Any]] = mapped_column(JSONType, nullable=False, default=dict)
    compiled_html: Mapped[str | None] = mapped_column(Text, nullable=True)
    published: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
