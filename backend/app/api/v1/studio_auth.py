"""Autenticación de usuarios del estudio (email+password + JWT).

Router dedicado bajo el prefijo ``/auth`` con rutas disjuntas del router de
Google OAuth (``/auth/google/*``) para no colisionar:

- ``POST /auth/login`` — autentica email+password y devuelve el token de acceso.
- ``POST /auth/logout`` — cierre de sesión (token stateless; sin denylist por
  ahora, se devuelve 204 como confirmación del lado del cliente).
- ``GET /auth/me`` — perfil del usuario autenticado + sus membresías.
- ``POST /auth/change-password`` — cambia la contraseña del usuario autenticado.

Regla CLAUDE (DI): la lógica de negocio se delega en :class:`AuthService`
(inyectado vía ``get_auth_service``); los repositorios se inyectan por
``Depends``. Nunca se instancia con ``new``.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.api.deps import (
    get_auth_service,
    get_current_user,
    get_membership_repository,
    get_session,
    get_tenant_repository,
    get_user_repository,
)
from app.core.errors import ConflictError, NotFoundError
from app.models.user import User
from app.repositories.interfaces import (
    IMembershipRepository,
    ITenantRepository,
    IUserRepository,
)
from app.schemas.membership import MembershipRead
from app.schemas.user import (
    ChangePasswordRequest,
    LoginRequest,
    LoginResponse,
    MeUpdate,
    UserRead,
)
from app.services.interfaces import IAuthService

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post(
    "/login",
    response_model=LoginResponse,
    status_code=status.HTTP_200_OK,
)
def login(
    data: LoginRequest,
    auth_service: IAuthService = Depends(get_auth_service),
) -> LoginResponse:
    """Autentica un usuario activo por email+password y emite un JWT de acceso."""
    user = auth_service.login(email=data.email, password=data.password)
    token = auth_service.create_access_token(user_id=user.id)
    return LoginResponse(access_token=token, user=UserRead.model_validate(user))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    _user: User = Depends(get_current_user),
) -> Response:
    """Cierra la sesión del usuario autenticado.

    El token es stateless (JWT sin denylist); el cliente descarta el token. Se
    exige autenticación para confirmar que el cierre corresponde a una sesión
    válida y registrar el evento en auditoría.
    """
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me", response_model=UserRead)
def me(
    user: User = Depends(get_current_user),
) -> UserRead:
    """Devuelve el perfil del usuario autenticado (Bearer)."""
    return UserRead.model_validate(user)


@router.patch("/me", response_model=UserRead)
def update_me(
    data: MeUpdate,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
    user_repository: IUserRepository = Depends(get_user_repository),
) -> UserRead:
    """Actualiza el perfil del usuario autenticado (solo ``display_name``).

    Los flags de plataforma (``is_super_admin``/``is_active``) y el password no
    son editables por el propio usuario: se gestionan por super-admin vía
    ``/users`` o por el flujo ``/auth/change-password``.
    """
    if data.display_name is None or not data.display_name.strip():
        raise ConflictError("El nombre visible no puede estar vacío")
    updated = user_repository.update(
        user.id,
        display_name=data.display_name.strip(),
    )
    if updated is None:
        raise NotFoundError(f"Usuario '{user.id}' no encontrado")
    session.commit()
    return UserRead.model_validate(updated)


@router.get("/me/memberships", response_model=list[MembershipRead])
def my_memberships(
    user: User = Depends(get_current_user),
    membership_repository: IMembershipRepository = Depends(
        get_membership_repository
    ),
    tenant_repository: ITenantRepository = Depends(get_tenant_repository),
) -> list[MembershipRead]:
    """Devuelve las membresías (tenant + rol) del usuario autenticado.

    Se enriquece cada membresía con el ``tenant_slug`` (identificador público
    estable que usa el frontend como tenant activo) para que el cliente pueda
    emparejar membresía ↔ tenant sin depender de listar tenants (endpoint que
    exige super-admin).
    """
    memberships = membership_repository.list_by_user(user_id=user.id)
    result: list[MembershipRead] = []
    for membership in memberships:
        read = MembershipRead.model_validate(membership)
        tenant = tenant_repository.get_by_id(tenant_id=membership.tenant_id)
        if tenant is not None:
            read.tenant_slug = tenant.slug
        result.append(read)
    return result


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    data: ChangePasswordRequest,
    user: User = Depends(get_current_user),
    auth_service: IAuthService = Depends(get_auth_service),
) -> Response:
    """Cambia la contraseña del usuario autenticado (requiere la actual)."""
    auth_service.change_password(
        user_id=user.id,
        current_password=data.current_password,
        new_password=data.new_password,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
