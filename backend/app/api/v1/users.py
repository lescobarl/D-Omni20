"""Gestión de usuarios de la plataforma (control-plane, super-admin).

Router bajo el prefijo ``/users`` exclusivo para super-admins. Permite el CRUD
de usuarios del estudio (sin RLS, a nivel plataforma) y la gestión de sus
membresías (usuario ↔ tenant + rol) para el RBAC por tenant.

Regla CLAUDE (DI): la lógica de negocio se delega en :class:`AuthService`
(inyectado vía ``get_auth_service``) para el hashing de contraseñas; los
repositorios se inyectan por ``Depends``. Nunca se instancia con ``new``.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.api.deps import (
    get_auth_service,
    get_membership_repository,
    get_session,
    get_user_repository,
    require_super_admin,
)
from app.core.errors import ConflictError, NotFoundError
from app.models.user import User
from app.repositories.interfaces import IMembershipRepository, IUserRepository
from app.schemas.membership import MembershipCreate, MembershipRead
from app.schemas.user import UserCreate, UserRead, UserUpdate
from app.services.interfaces import IAuthService

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=list[UserRead])
def list_users(
    _admin: User = Depends(require_super_admin),
    user_repository: IUserRepository = Depends(get_user_repository),
) -> list[UserRead]:
    """Lista todos los usuarios de la plataforma (control-plane)."""
    return [UserRead.model_validate(u) for u in user_repository.list_all()]


@router.post("", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def create_user(
    data: UserCreate,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_super_admin),
    user_repository: IUserRepository = Depends(get_user_repository),
    auth_service: IAuthService = Depends(get_auth_service),
) -> UserRead:
    """Crea un usuario de plataforma (email único, password hasheado con bcrypt)."""
    existing = user_repository.get_by_email(data.email)
    if existing is not None:
        raise ConflictError(f"Ya existe un usuario con el email '{data.email}'")

    password_hash = auth_service.hash_password(data.password)
    user = user_repository.create(
        email=data.email,
        password_hash=password_hash,
        display_name=data.display_name,
        is_super_admin=data.is_super_admin,
    )
    session.commit()
    return UserRead.model_validate(user)


@router.get("/{user_id}", response_model=UserRead)
def get_user(
    user_id: uuid.UUID,
    _admin: User = Depends(require_super_admin),
    user_repository: IUserRepository = Depends(get_user_repository),
) -> UserRead:
    """Devuelve el detalle de un usuario por su UUID."""
    user = user_repository.get_by_id(user_id)
    if user is None:
        raise NotFoundError(f"Usuario '{user_id}' no encontrado")
    return UserRead.model_validate(user)


@router.patch("/{user_id}", response_model=UserRead)
def update_user(
    user_id: uuid.UUID,
    data: UserUpdate,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_super_admin),
    user_repository: IUserRepository = Depends(get_user_repository),
    auth_service: IAuthService = Depends(get_auth_service),
) -> UserRead:
    """Actualiza perfil / flags / reset de password de un usuario."""
    user = user_repository.get_by_id(user_id)
    if user is None:
        raise NotFoundError(f"Usuario '{user_id}' no encontrado")

    password_hash = None
    if data.password is not None:
        password_hash = auth_service.hash_password(data.password)

    user = user_repository.update(
        user_id,
        display_name=data.display_name,
        password_hash=password_hash,
        is_super_admin=data.is_super_admin,
        is_active=data.is_active,
    )
    session.commit()
    return UserRead.model_validate(user)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: uuid.UUID,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_super_admin),
    user_repository: IUserRepository = Depends(get_user_repository),
) -> Response:
    """Elimina (soft-delete) un usuario de la plataforma."""
    user = user_repository.get_by_id(user_id)
    if user is None:
        raise NotFoundError(f"Usuario '{user_id}' no encontrado")
    user_repository.soft_delete(user_id)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{user_id}/memberships", response_model=list[MembershipRead])
def list_user_memberships(
    user_id: uuid.UUID,
    _admin: User = Depends(require_super_admin),
    membership_repository: IMembershipRepository = Depends(
        get_membership_repository
    ),
) -> list[MembershipRead]:
    """Lista las membresías (tenant + rol) de un usuario."""
    memberships = membership_repository.list_by_user(user_id=user_id)
    return [MembershipRead.model_validate(m) for m in memberships]


@router.post(
    "/{user_id}/memberships",
    response_model=MembershipRead,
    status_code=status.HTTP_201_CREATED,
)
def add_user_membership(
    user_id: uuid.UUID,
    data: MembershipCreate,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_super_admin),
    membership_repository: IMembershipRepository = Depends(
        get_membership_repository
    ),
) -> MembershipRead:
    """Añade una membresía (tenant + rol) a un usuario de la plataforma."""
    if data.user_id != user_id:
        raise ConflictError(
            "El user_id del path y del payload deben coincidir"
        )
    existing = membership_repository.get_by_user_and_tenant(
        user_id=user_id,
        tenant_id=data.tenant_id,
    )
    if existing is not None:
        raise ConflictError(
            "El usuario ya tiene una membresía en ese tenant"
        )
    membership = membership_repository.create(
        user_id=user_id,
        tenant_id=data.tenant_id,
        role=data.role,
    )
    session.commit()
    return MembershipRead.model_validate(membership)


@router.delete(
    "/{user_id}/memberships/{membership_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def remove_user_membership(
    user_id: uuid.UUID,
    membership_id: uuid.UUID,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_super_admin),
    membership_repository: IMembershipRepository = Depends(
        get_membership_repository
    ),
) -> Response:
    """Elimina (soft-delete) la membresía de un usuario de la plataforma."""
    memberships = membership_repository.list_by_user(user_id=user_id)
    target = next((m for m in memberships if m.id == membership_id), None)
    if target is None:
        raise NotFoundError(
            f"Membresía '{membership_id}' no encontrada para el usuario '{user_id}'"
        )
    membership_repository.delete(
        user_id=user_id,
        tenant_id=target.tenant_id,
    )
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
