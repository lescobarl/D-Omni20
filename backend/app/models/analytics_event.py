"""Modelo ``analytics_events`` — eventos de analítica por tenant (append-only).

Inmutable (append-only): no incluye tupla sync (revision/updated_at/deleted)
porque jamás se actualiza ni borra; solo se inserta. Cada evento describe una
acción del tenant (vista de landing, click, conversión, importación...) con
contexto estructurado en ``properties``.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, JSONType, TimestampsMixin, UUIDPrimaryKeyMixin, utcnow


class AnalyticsEvent(Base, UUIDPrimaryKeyMixin, TimestampsMixin):
    """Evento de analítica perteneciente a un tenant, inmutable.

    ``event_type`` clasifica la acción (p. ej. ``landing.view``, ``conversion``);
    ``entity_type``/``entity_id`` enlazan el evento con la entidad de negocio
    afectada; ``properties`` guarda atributos libres de la métrica.
    """

    __tablename__ = "analytics_events"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    event_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    entity_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    entity_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    properties: Mapped[dict[str, Any]] = mapped_column(
        JSONType, nullable=False, default=dict
    )
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utcnow,
    )
