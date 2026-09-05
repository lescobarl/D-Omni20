"""Modelos de autenticación de usuarios del estudio + RBAC (control-plane).

Reglas CLAUDE aplicadas:
- ``users`` y ``tenant_memberships`` son **control-plane** (como ``tenants``):
  NO llevan RLS ni ``TenantScopedMixin`` porque el aislamiento por tenant se
  resuelve a nivel de aplicación (verificación de membresía) y un super-admin
  debe poder ver todos los tenants.
- ``Role`` se define como ``StrEnum`` en código y se persiste como columna
  enum portable (``SaEnum`` con ``native_enum=False``) para que funcione tanto
  en PostgreSQL como en SQLite (dev/tests).
- ``is_super_admin`` es un flag de plataforma, independiente de los roles por
  tenant: un super-admin puede o no tener membresías.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum as SaEnum,
    ForeignKey,
    String,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import (
    Base,
    SyncTupleMixin,
    TimestampsMixin,
    UUIDPrimaryKeyMixin,
)


class Role(StrEnum):
    """Roles de un usuario dentro de un tenant (RBAC por tenant)."""

    ADMIN = "admin"  # administra el tenant (miembros, configuración)
    CONFIGURADOR = "configurador"  # configura contenido/landings/bot/catálogo
    OPERADOR = "operador"  # opera CRM/campañas/atenciones/estadísticas


class User(Base, UUIDPrimaryKeyMixin, TimestampsMixin, SyncTupleMixin):
    """Usuario del estudio (plataforma). Control-plane, sin RLS."""

    __tablename__ = "users"

    email: Mapped[str] = mapped_column(
        String(255), nullable=False, unique=True, index=True
    )
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_super_admin: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    last_login_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class TenantMembership(Base, UUIDPrimaryKeyMixin, TimestampsMixin, SyncTupleMixin):
    """Membresía de un usuario en un tenant con un rol. Control-plane, sin RLS."""

    __tablename__ = "tenant_memberships"
    __table_args__ = (
        UniqueConstraint("user_id", "tenant_id", name="uq_membership_user_tenant"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    role: Mapped[Role] = mapped_column(
        SaEnum(Role, name="role_enum", native_enum=False, length=32),
        nullable=False,
    )
