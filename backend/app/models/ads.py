"""Modelo ``ad_campaigns`` — campañas publicitarias con atribución UTM (eslabón ①).

Campos clave:
- ``tenant_id``: columna de aislamiento RLS (ver :class:`TenantScopedMixin`).
- ``name``: nombre natural de la campaña, único dentro del tenant.
- Parámetros UTM (``utm_source``/``utm_medium``/``utm_campaign``/``utm_content``/
  ``utm_term``): la firma con la que se atribuye un lead capturado al vuelo.
- ``landing_id``: landing de destino (FK → ``tenant_landings.id``, SET NULL).
- ``enabled``/``status``/``budget_minor``: ciclo de vida y presupuesto (minor).
- ``start_at``/``end_at``: ventana de vigencia de la campaña.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import (
    Base,
    SyncTupleMixin,
    TenantScopedMixin,
    TimestampsMixin,
    UUIDPrimaryKeyMixin,
)


class AdCampaign(Base, UUIDPrimaryKeyMixin, TimestampsMixin, SyncTupleMixin, TenantScopedMixin):
    __tablename__ = "ad_campaigns"
    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_ad_campaigns_tenant_name"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active", index=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    utm_source: Mapped[str | None] = mapped_column(String(255), nullable=True)
    utm_medium: Mapped[str | None] = mapped_column(String(255), nullable=True)
    utm_campaign: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    utm_content: Mapped[str | None] = mapped_column(String(255), nullable=True)
    utm_term: Mapped[str | None] = mapped_column(String(255), nullable=True)
    landing_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("tenant_landings.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    budget_minor: Mapped[int | None] = mapped_column(Integer, nullable=True)
    start_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    end_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
