"""Esquemas de usuarios del estudio y autenticación (contrato público de la API)."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel


_EMAIL_PATTERN = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"


class UserCreate(BaseModel):
    """Payload para crear un usuario de plataforma (super-admin)."""

    email: str = Field(pattern=_EMAIL_PATTERN, max_length=255)
    password: str = Field(min_length=8, max_length=128)
    display_name: str | None = Field(default=None, max_length=255)
    is_super_admin: bool = False


class UserUpdate(BaseModel):
    """Payload para actualizar un usuario (flags / perfil / reset de password)."""

    display_name: str | None = Field(default=None, max_length=255)
    password: str | None = Field(default=None, min_length=8, max_length=128)
    is_super_admin: bool | None = None
    is_active: bool | None = None


class UserRead(ORMModel):
    """Usuario tal como se expone a los clientes (sin hash de contraseña)."""

    id: uuid.UUID
    email: str
    display_name: str | None
    is_super_admin: bool
    is_active: bool
    last_login_at: datetime | None
    created_at: datetime
    revision: int
    updated_at: datetime


class LoginRequest(BaseModel):
    """Credenciales de acceso al estudio."""

    email: str = Field(pattern=_EMAIL_PATTERN, max_length=255)
    password: str = Field(min_length=1, max_length=128)


class ChangePasswordRequest(BaseModel):
    """Cambio de contraseña del usuario autenticado."""

    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class LoginResponse(BaseModel):
    """Respuesta de login: token de acceso + perfil del usuario."""

    access_token: str
    token_type: str = "bearer"
    user: UserRead
