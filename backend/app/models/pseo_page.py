"""Modelo ``pseo_pages`` — páginas programáticas PSEO servidas (Fase D).

Cada fila es una página resuelta/compilada de una matriz programática, con su
HTML compilado y su ``canonical_url`` correcta para el host del tenant. La
versión es por página (``version``) y se incrementa cuando el contenido cambia
para un ``slug_path`` ya existente; el ``UniqueConstraint("tenant_id",
"slug_path")`` garantiza una única página viva por slug dentro del tenant.
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


class PseoPage(Base, UUIDPrimaryKeyMixin, TimestampsMixin, SyncTupleMixin, TenantScopedMixin):
    __tablename__ = "pseo_pages"
    __table_args__ = (
        UniqueConstraint("tenant_id", "slug_path", name="uq_pseo_page_tenant_slug"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    batch_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("pseo_batches.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    city: Mapped[str] = mapped_column(String(255), nullable=False)
    service_slug: Mapped[str] = mapped_column(String(255), nullable=False)
    service_name: Mapped[str] = mapped_column(String(255), nullable=False)
    offer_price: Mapped[str] = mapped_column(String(64), nullable=False)
    slug_path: Mapped[str] = mapped_column(String(512), nullable=False, index=True)
    compiled_html: Mapped[str | None] = mapped_column(Text, nullable=True)
    canonical_url: Mapped[str] = mapped_column(String(512), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    published: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
