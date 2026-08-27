"""Modelo ``schema_versions`` — snapshots versionados de JSON Schemas (Draft 2020-12)."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import ForeignKey, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import (
    Base,
    JSONType,
    TimestampsMixin,
    UUIDPrimaryKeyMixin,
)


class SchemaVersion(Base, UUIDPrimaryKeyMixin, TimestampsMixin):
    """Snapshot inmutable de un ``DeveloperSchema`` en un punto del tiempo.

    Un schema puede tener N versiones (1:N con ``developer_schemas``). Cada
    versión conserva el ``schema_json`` congelado, la etiqueta semántica y una
    nota de cambio opcional. Las versiones son append-only: nunca se editan.
    """

    __tablename__ = "schema_versions"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    schema_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("developer_schemas.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    version: Mapped[str] = mapped_column(String(32), nullable=False)
    schema_json: Mapped[dict[str, Any]] = mapped_column(
        JSONType, nullable=False, default=dict
    )
    change_note: Mapped[str | None] = mapped_column(Text, nullable=True)
