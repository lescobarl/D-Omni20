"""Endpoints de despliegue al CDN (Fase 10): versiones compiladas por landing."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, status

from app.api.deps import get_cdn_deployment_service, get_current_tenant
from app.schemas.cdn import CdnDeployResponse
from app.services.interfaces import ICdnDeploymentService

router = APIRouter(prefix="/cdn", tags=["cdn"])


@router.post(
    "/deploy/{landing_id}",
    response_model=CdnDeployResponse,
    status_code=status.HTTP_201_CREATED,
)
def deploy_landing(
    landing_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: ICdnDeploymentService = Depends(get_cdn_deployment_service),
) -> CdnDeployResponse:
    """Despliega la landing del tenant activo al CDN (versión incremental).

    Compila la configuración actual, calcula la ``version`` siguiente de la
    landing, persiste el despliegue (append-only) y devuelve la URL versionada
    servida por el CDN.
    """
    return service.deploy(tenant_id=tenant_id, landing_id=landing_id)
