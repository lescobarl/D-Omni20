"""Modelo ``marketplace_templates`` — catálogo de plantillas reutilizables de landings."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import (
    Base,
    JSONType,
    TimestampsMixin,
    UUIDPrimaryKeyMixin,
)


class MarketplaceTemplate(Base, UUIDPrimaryKeyMixin, TimestampsMixin):
    """Plantilla publicable en el marketplace para crear landings.

    Una plantilla encapsula un ``config`` de diseño reutilizable (bloques del
    editor) que cualquier tenant puede importar para crear una landing propia.
    ``tenant_id`` identifica al autor; ``is_public`` controla la visibilidad en
    el catálogo y ``downloads`` cuenta las importaciones (append-only).
    """

    __tablename__ = "marketplace_templates"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    category: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    config: Mapped[dict[str, Any]] = mapped_column(
        JSONType, nullable=False, default=dict
    )
    thumbnail_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_public: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    downloads: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
