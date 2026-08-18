"""Modelo ``tenants`` — raíz del multi-tenancy (regla CLAUDE: RLS).

Cada fila es un tenant. ``slug`` es el identificador público estable que usa el
frontend (``X-Tenant-Id`` puede traer UUID o slug) y es único.
"""

from __future__ import annotations

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, SyncTupleMixin, TimestampsMixin, UUIDPrimaryKeyMixin


class Tenant(Base, UUIDPrimaryKeyMixin, TimestampsMixin, SyncTupleMixin):
    __tablename__ = "tenants"

    slug: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
