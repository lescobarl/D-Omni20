"""Gestión de miembros por tenant (RBAC, admin).

Router bajo el prefijo ``/members`` que opera sobre el **tenant activo**
(resuelto por ``get_current_tenant`` desde la cabecera ``X-Tenant-Id``). Permite
a un admin del tenant listar, añadir, cambiar el rol y eliminar miembros.

Regla CLAUDE (DI): la lógica de negocio se delega en :class:`AuthService`
(inyectado vía ``get_auth_service``) para el hashing de contraseñas al crear un
usuario nuevo; los repositorios se inyectan por ``Depends``. Nunca se instancia
con ``new``.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.api.deps import (
    get_auth_service,
    get_current_tenant,
    get_membership_repository,
    get_session,
    get_user_repository,
    require_role,
)
from app.core.errors import ConflictError, NotFoundError
from app.models.user import Role, User
from app.repositories.interfaces import IMembershipRepository, IUserRepository
from app.schemas.membership import (
    MemberAddRequest,
    MembershipRead,
    MembershipUpdate,
)
from app.services.interfaces import IAuthService

router = APIRouter(prefix="/members", tags=["members"])


def _resolve_membership(
    membership_id: uuid.UUID,
    tenant_id: uuid.UUID,
    membership_repository: IMembershipRepository,
) -> tuple[uuid.UUID, uuid.UUID]:
    """Resuelve un ``membership_id`` a ``(user_id, tenant_id)`` dentro del tenant.

    El repositorio opera por ``(user_id, tenant_id)`` (sin ``get_by_id``), así que
    se localiza la membresía listando las del tenant activo y buscando por id.
    Esto mantiene el acceso acotado al tenant (defensa en profundidad).
    """
    for membership in membership_repository.list_by_tenant(tenant_id=tenant_id):
        if membership.id == membership_id:
            return membership.user_id, membership.tenant_id
    raise NotFoundError(f"Membresía '{membership_id}' no encontrada en el tenant")


@router.get("", response_model=list[MembershipRead])
def list_members(
    _admin: User = Depends(require_role(Role.ADMIN)),
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    membership_repository: IMembershipRepository = Depends(
        get_membership_repository
    ),
) -> list[MembershipRead]:
    """Lista los miembros (membresías) del tenant activo."""
    memberships = membership_repository.list_by_tenant(tenant_id=tenant_id)
    return [MembershipRead.model_validate(m) for m in memberships]


@router.post(
    "",
    response_model=MembershipRead,
    status_code=status.HTTP_201_CREATED,
)
def add_member(
    data: MemberAddRequest,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_role(Role.ADMIN)),
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    membership_repository: IMembershipRepository = Depends(
        get_membership_repository
    ),
    user_repository: IUserRepository = Depends(get_user_repository),
    auth_service: IAuthService = Depends(get_auth_service),
) -> MembershipRead:
    """Añade un miembro al tenant activo por email (existente o crea) con rol."""
    user = user_repository.get_by_email(data.email)
    if user is None:
        if data.password is None:
            raise ConflictError(
                "El email no corresponde a un usuario existente; se requiere "
                "una contraseña para crearlo"
            )
        password_hash = auth_service.hash_password(data.password)
        user = user_repository.create(
            email=data.email,
            password_hash=password_hash,
            display_name=data.display_name,
        )
        session.flush()

    existing = membership_repository.get_by_user_and_tenant(
        user_id=user.id,
        tenant_id=tenant_id,
    )
    if existing is not None:
        raise ConflictError(
            f"El usuario '{data.email}' ya es miembro del tenant activo"
        )

    membership = membership_repository.create(
        user_id=user.id,
        tenant_id=tenant_id,
        role=data.role,
    )
    session.commit()
    return MembershipRead.model_validate(membership)


@router.patch("/{membership_id}", response_model=MembershipRead)
def update_member_role(
    membership_id: uuid.UUID,
    data: MembershipUpdate,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_role(Role.ADMIN)),
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    membership_repository: IMembershipRepository = Depends(
        get_membership_repository
    ),
) -> MembershipRead:
    """Cambia el rol de un miembro del tenant activo."""
    user_id, resolved_tenant_id = _resolve_membership(
        membership_id, tenant_id, membership_repository
    )
    membership = membership_repository.update_role(
        user_id=user_id,
        tenant_id=resolved_tenant_id,
        role=data.role,
    )
    if membership is None:
        raise NotFoundError(
            f"Membresía '{membership_id}' no encontrada en el tenant"
        )
    session.commit()
    return MembershipRead.model_validate(membership)


@router.delete("/{membership_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_member(
    membership_id: uuid.UUID,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_role(Role.ADMIN)),
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    membership_repository: IMembershipRepository = Depends(
        get_membership_repository
    ),
) -> Response:
    """Elimina (soft-delete) a un miembro del tenant activo."""
    user_id, resolved_tenant_id = _resolve_membership(
        membership_id, tenant_id, membership_repository
    )
    membership_repository.delete(
        user_id=user_id,
        tenant_id=resolved_tenant_id,
    )
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
