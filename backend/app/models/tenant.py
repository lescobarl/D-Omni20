"""Modelos del subsistema de tenants (regla CLAUDE: RLS multi-tenant).

- :class:`Tenant` — raíz del multi-tenancy; ``slug`` es el identificador
  público estable que usa el frontend (``X-Tenant-Id`` puede traer UUID o
  slug) y es único.
- :class:`TenantOAuthToken` — tokens OAuth de un tenant persistidos CIFRADOS
  en reposo (Fase 3 del backlog: persistencias cifradas de tokens Google).
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import (
    Base,
    SyncTupleMixin,
    TenantScopedMixin,
    TimestampsMixin,
    UUIDPrimaryKeyMixin,
)


class Tenant(Base, UUIDPrimaryKeyMixin, TimestampsMixin, SyncTupleMixin):
    __tablename__ = "tenants"

    slug: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)


class TenantOAuthToken(
    Base, UUIDPrimaryKeyMixin, TimestampsMixin, SyncTupleMixin, TenantScopedMixin
):
    """Token OAuth (Google Calendar) de un tenant, cifrado en reposo.

    Un solo token por (tenant, provider) — el upsert del repositorio lo
    garantiza junto con la restricción única compuesta.
    """

    __tablename__ = "tenant_oauth_tokens"
    __table_args__ = (
        UniqueConstraint("tenant_id", "provider", name="uq_tenant_oauth_provider"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    provider: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    encrypted_access_token: Mapped[str] = mapped_column(Text, nullable=False)
    encrypted_refresh_token: Mapped[str] = mapped_column(Text, nullable=False, default="")
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
