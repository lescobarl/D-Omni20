"""Endpoints del diseñador de landings (CRUD + publicar + compilar).

Todos los endpoints requieren el tenant activo vía ``X-Tenant-Id``
(``get_current_tenant``) y delegan en :class:`ILandingService` (puerto
inyectado por ``Depends`` — regla CLAUDE: DI).
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response, status

from app.api.deps import get_current_tenant, get_landing_service
from app.schemas.common import Page, Pagination
from app.schemas.landing import (
    LandingCompileRequest,
    LandingCompileResponse,
    LandingCreate,
    LandingPublishRequest,
    LandingRead,
    LandingUpdate,
)
from app.services.interfaces import ILandingService

router = APIRouter(prefix="/designer", tags=["designer"])


@router.get("", response_model=Page[LandingRead])
def list_landings(
    pagination: Pagination = Depends(),
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: ILandingService = Depends(get_landing_service),
) -> Page[LandingRead]:
    """Lista las landings del tenant activo (paginado)."""
    return service.list(
        tenant_id=tenant_id, page=pagination.page, page_size=pagination.page_size
    )


@router.post("", response_model=LandingRead, status_code=status.HTTP_201_CREATED)
def create_landing(
    data: LandingCreate,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: ILandingService = Depends(get_landing_service),
) -> LandingRead:
    """Crea una landing para una campaña del tenant (unique por tenant+campaña)."""
    return service.create(tenant_id=tenant_id, data=data)


@router.get("/{landing_id}", response_model=LandingRead)
def get_landing(
    landing_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: ILandingService = Depends(get_landing_service),
) -> LandingRead:
    """Devuelve una landing del tenant activo (404 si no existe)."""
    return service.get(tenant_id=tenant_id, landing_id=landing_id)


@router.patch("/{landing_id}", response_model=LandingRead)
def update_landing(
    landing_id: uuid.UUID,
    data: LandingUpdate,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: ILandingService = Depends(get_landing_service),
) -> LandingRead:
    """Actualiza parcialmente una landing (PATCH semantics)."""
    return service.update(tenant_id=tenant_id, landing_id=landing_id, data=data)


@router.delete("/{landing_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_landing(
    landing_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: ILandingService = Depends(get_landing_service),
) -> Response:
    """Soft-delete de una landing (nunca borrado físico)."""
    service.delete(tenant_id=tenant_id, landing_id=landing_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{landing_id}/publish", response_model=LandingRead)
def publish_landing(
    landing_id: uuid.UUID,
    data: LandingPublishRequest,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: ILandingService = Depends(get_landing_service),
) -> LandingRead:
    """Publica o despublica una landing del tenant activo."""
    return service.publish(
        tenant_id=tenant_id, landing_id=landing_id, published=data.published
    )


@router.post("/compile", response_model=LandingCompileResponse)
def compile_landing(
    data: LandingCompileRequest,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: ILandingService = Depends(get_landing_service),
) -> LandingCompileResponse:
    """Compila una configuración (config → HTML) sin persistirla."""
    return service.compile(tenant_id=tenant_id, data=data)
