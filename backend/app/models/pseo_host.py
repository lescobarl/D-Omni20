"""Modelo ``pseo_hosts`` — mapeo ``host`` → ``tenant_id`` para serving público.

Permite resolver el tenant del request de serving público (``GET /pseo/...`` y
``sitemap.xml``) a partir del header ``Host``, sin exponer ``X-Tenant-Id`` ni
filtrar la existencia de tenants. En dev/tests se siembra con el host derivado
de ``settings.cdn_base_url`` (p. ej. ``localhost:8000``).

Un host solo puede pertenecer a un tenant (constraint única por host), lo que
hace el mapeo determinista. Incluye la tupla sync ``[revision, updated_at,
deleted]`` y el tenant-scoping RLS.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import (
    Base,
    SyncTupleMixin,
    TenantScopedMixin,
    TimestampsMixin,
    UUIDPrimaryKeyMixin,
)


class PseoHost(Base, UUIDPrimaryKeyMixin, TimestampsMixin, SyncTupleMixin, TenantScopedMixin):
    __tablename__ = "pseo_hosts"
    __table_args__ = (
        UniqueConstraint("host", name="uq_pseo_host_host"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    host: Mapped[str] = mapped_column(String(255), nullable=False, index=True)

    # Estado del dominio personalizado (feature "Dominios").
    # ``pending`` = registrado y a la espera de verificación DNS (TXT
    # ``omni2-verify=<token>``); ``active`` = verificado y servible públicamente.
    # Solo los hosts ``active`` resuelven tenant en ``get_pseo_tenant_by_host``
    # (fail-closed 404 para pending/deleted — sin leak). El seed de dev/tests usa
    # ``upsert`` (activa el host) para que el serving público siga funcionando.
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="pending", index=True
    )
    verify_token: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # Solo se fija cuando la verificación DNS del TXT tiene éxito (no auto-fill).
    verified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
