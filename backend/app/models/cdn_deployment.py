"""Modelo ``cdn_deployments`` — despliegues de landings al CDN (Fase 10).

Append-only (inmutable): cada despliegue crea una versión nueva del HTML
compilado servido por el CDN bajo una URL versionada. No incluye tupla sync
(revision/updated_at/deleted) porque jamás se actualiza ni borra; solo se
inserta. ``html`` guarda el contenido que el CDN sirve (compilado desde el
``config`` de la landing en el momento del despliegue).
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampsMixin, UUIDPrimaryKeyMixin, utcnow


class CdnDeployment(Base, UUIDPrimaryKeyMixin, TimestampsMixin):
    """Despliegue de una landing al CDN, perteneciente a un tenant, inmutable.

    Cada despliegue genera una ``version`` incremental por landing y una
    ``url`` determinista ``{cdn_base_url}/{landing_id}/v{version}``; ``html``
    contiene el contenido servido por el CDN en esa URL.
    """

    __tablename__ = "cdn_deployments"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    landing_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("tenant_landings.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    url: Mapped[str] = mapped_column(String(512), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="deployed")
    html: Mapped[str | None] = mapped_column(Text, nullable=True)
    deployed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utcnow,
    )
