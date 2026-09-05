"""Endpoints de dominios personalizados del tenant (PSEO).

Registro (pending), verificación de propiedad DNS (TXT), activación,
listado y baja de los dominios propios del tenant. Todos los endpoints
requieren el tenant activo vía ``X-Tenant-Id`` (``get_current_tenant``)
y delegan en :class:`IPseoHostService` (puerto inyectado por ``Depends``
— regla CLAUDE: DI). Solo los hosts ``active`` son servidos públicamente
(ver ``get_pseo_tenant_by_host`` en ``app.api.deps``).
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response, status

from app.api.deps import get_current_tenant, get_pseo_host_service, require_role
from app.models.user import Role
from app.schemas.pseo import PseoHostRead, PseoHostRequest
from app.services.interfaces import IPseoHostService

router = APIRouter(
    prefix="/pseo/hosts",
    tags=["pseo-hosts"],
    dependencies=[Depends(require_role(Role.ADMIN, Role.CONFIGURADOR))],
)


@router.get("", response_model=list[PseoHostRead])
def list_hosts(
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: IPseoHostService = Depends(get_pseo_host_service),
) -> list[PseoHostRead]:
    """Lista los dominios personalizados del tenant activo."""
    return service.list_domains(tenant_id=tenant_id)


@router.post("", response_model=PseoHostRead, status_code=status.HTTP_201_CREATED)
def request_host(
    data: PseoHostRequest,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: IPseoHostService = Depends(get_pseo_host_service),
) -> PseoHostRead:
    """Registra un dominio personalizado en estado ``pending``.

    Devuelve el ``verify_token`` (registro TXT ``_omni2-verify.<host>``)
    necesario para verificar la propiedad del dominio.
    """
    return service.request_domain(tenant_id=tenant_id, host=data.host)


@router.post("/{host_id}/verify", response_model=PseoHostRead)
def verify_host(
    host_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: IPseoHostService = Depends(get_pseo_host_service),
) -> PseoHostRead:
    """Verifica la propiedad DNS (TXT) del dominio y lo activa si es correcto."""
    return service.verify_domain(tenant_id=tenant_id, host_id=host_id)


@router.delete("/{host_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_host(
    host_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: IPseoHostService = Depends(get_pseo_host_service),
) -> Response:
    """Da de baja (soft-delete) el dominio personalizado del tenant."""
    service.remove_domain(tenant_id=tenant_id, host_id=host_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
