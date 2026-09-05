"""Esquemas de membresías usuario↔tenant (RBAC por tenant, contrato público)."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.models.user import Role
from app.schemas.common import ORMModel


class MembershipCreate(BaseModel):
    """Payload para añadir una membresía (usuario + tenant + rol)."""

    user_id: uuid.UUID
    tenant_id: uuid.UUID
    role: Role


class MembershipUpdate(BaseModel):
    """Payload para cambiar el rol de una membresía."""

    role: Role


class MembershipRead(ORMModel):
    """Membresía tal como se expone a los clientes.

    ``tenant_slug`` es el identificador público estable del tenant (el frontend
    usa el slug como tenant activo). Se enriquece en los endpoints que lo
    resuelven; es opcional para no romper las validaciones desde objetos ORM
    que no lo exponen.
    """

    id: uuid.UUID
    user_id: uuid.UUID
    tenant_id: uuid.UUID
    tenant_slug: str | None = None
    role: Role
    created_at: datetime
    revision: int
    updated_at: datetime


class MemberAddRequest(BaseModel):
    """Añade un miembro al tenant activo por email (existente o nuevo) con rol."""

    email: str = Field(
        pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$", max_length=255
    )
    role: Role
    display_name: str | None = Field(default=None, max_length=255)
    # Solo se usa si el email no corresponde a un usuario existente.
    password: str | None = Field(default=None, min_length=8, max_length=128)
