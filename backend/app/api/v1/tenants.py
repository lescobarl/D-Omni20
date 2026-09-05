"""Endpoints de alta y consulta de tenants (control plane).

Cierra el gap de "despliegue automático de cualquier cliente": permite crear un
tenant y provisionar su subdominio dinámico ``{slug}.{client_subdomain_base}``
exclusivamente vía API, sin depender de scripts. Una vez dado de alta, el
configurador opera sobre él con ``X-Tenant-Id`` (``get_current_tenant``).

Regla CLAUDE (nada de hardcode, todo dinámico):
- El subdominio se deriva SIEMPRE del ``slug`` + el setting
  ``client_subdomain_base`` (nunca se embebe un slug concreto).
- La creación es idempotente por slug: si el tenant ya existe se devuelve tal
  cual (200) en lugar de fallar, y se asegura su subdominio en la misma
  transacción (``provision_client_subdomain`` es idempotente).
"""

from __future__ import annotations

import uuid
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.api.deps import (
    get_container,
    get_pseo_host_repository,
    get_session,
    get_tenant_repository,
    require_super_admin,
)
from app.core.di import Container
from app.core.errors import ConflictError, NotFoundError
from app.models.user import User
from app.repositories.interfaces import IPseoHostRepository, ITenantRepository
from app.schemas.tenant import TenantCreate, TenantRead, TenantUpdate
from app.services.client_subdomain import provision_client_subdomain

router = APIRouter(prefix="/tenants", tags=["tenants"])


@router.post("", response_model=TenantRead, status_code=status.HTTP_201_CREATED)
def create_tenant(
    data: TenantCreate,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_super_admin),
    repository: ITenantRepository = Depends(get_tenant_repository),
    host_repository: IPseoHostRepository = Depends(get_pseo_host_repository),
    container: Container = Depends(get_container),
) -> TenantRead:
    """Crea un tenant y provisiona su subdominio dinámico en la misma transacción.

    Si el ``slug`` ya existe, devuelve el tenant existente (idempotente) y se
    asegura de que su subdominio esté registrado. El subdominio derivado
    ``{slug}.{client_subdomain_base}`` se registra como host ``active`` para el
    serving público (``get_pseo_tenant_by_host``).
    """
    settings = container.settings
    tenant = repository.get_by_slug(data.slug)
    if tenant is None:
        tenant = repository.create(data.slug, data.name)
    elif tenant.name != data.name:
        raise ConflictError(
            f"El slug '{data.slug}' ya está en uso por el tenant '{tenant.name}'"
        )

    cdn_host = urlparse(settings.cdn_base_url).netloc or None
    provision_client_subdomain(
        session,
        tenant=tenant,
        client_subdomain_base=settings.client_subdomain_base,
        cdn_host=cdn_host,
        host_repository=host_repository,
    )
    session.commit()
    return TenantRead.model_validate(tenant)


@router.get("", response_model=list[TenantRead])
def list_tenants(
    _admin: User = Depends(require_super_admin),
    repository: ITenantRepository = Depends(get_tenant_repository),
) -> list[TenantRead]:
    """Lista todos los tenants activos (control plane)."""
    return [TenantRead.model_validate(t) for t in repository.list_all()]


@router.get("/{slug}", response_model=TenantRead)
def get_tenant(
    slug: str,
    _admin: User = Depends(require_super_admin),
    repository: ITenantRepository = Depends(get_tenant_repository),
) -> TenantRead:
    """Devuelve un tenant por su slug."""
    tenant = repository.get_by_slug(slug)
    if tenant is None:
        raise NotFoundError(f"Tenant '{slug}' no encontrado")
    return TenantRead.model_validate(tenant)


@router.patch("/{slug}", response_model=TenantRead)
def update_tenant(
    slug: str,
    data: TenantUpdate,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_super_admin),
    repository: ITenantRepository = Depends(get_tenant_repository),
) -> TenantRead:
    """Actualiza el nombre de un tenant (el slug es inmutable)."""
    tenant = repository.get_by_slug(slug)
    if tenant is None:
        raise NotFoundError(f"Tenant '{slug}' no encontrado")
    if data.name is not None and data.name != tenant.name:
        tenant = repository.update(tenant.id, data.name)
    session.commit()
    return TenantRead.model_validate(tenant)


@router.delete("/{slug}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tenant(
    slug: str,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_super_admin),
    repository: ITenantRepository = Depends(get_tenant_repository),
) -> Response:
    """Elimina (soft-delete) un tenant por su slug."""
    tenant = repository.get_by_slug(slug)
    if tenant is None:
        raise NotFoundError(f"Tenant '{slug}' no encontrado")
    repository.delete(tenant.id)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
