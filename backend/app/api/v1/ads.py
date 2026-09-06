"""Endpoints de campañas publicitarias (CRUD + atribución UTM) — eslabón ①.

Todos los endpoints requieren el tenant activo vía ``X-Tenant-Id``
(``get_current_tenant``) y delegan en :class:`IAdsService` (puerto
inyectado por ``Depends`` — regla CLAUDE: DI).
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response, status

from app.api.deps import get_ads_service, get_current_tenant, require_role
from app.models.user import Role
from app.schemas.ads import AdCampaignCreate, AdCampaignRead, AdCampaignUpdate
from app.schemas.common import Page, Pagination
from app.services.interfaces import IAdsService

router = APIRouter(
    prefix="/ads",
    tags=["ads"],
    dependencies=[Depends(require_role(Role.ADMIN))],
)


@router.get("", response_model=Page[AdCampaignRead])
def list_ad_campaigns(
    pagination: Pagination = Depends(),
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: IAdsService = Depends(get_ads_service),
) -> Page[AdCampaignRead]:
    """Lista las campañas publicitarias del tenant activo (paginado)."""
    return service.list(
        tenant_id=tenant_id, page=pagination.page, page_size=pagination.page_size
    )


@router.post("", response_model=AdCampaignRead, status_code=status.HTTP_201_CREATED)
def create_ad_campaign(
    data: AdCampaignCreate,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: IAdsService = Depends(get_ads_service),
) -> AdCampaignRead:
    """Crea una campaña publicitaria para el tenant (unique por tenant+nombre)."""
    return service.create(tenant_id=tenant_id, data=data)


@router.get("/{ad_campaign_id}", response_model=AdCampaignRead)
def get_ad_campaign(
    ad_campaign_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: IAdsService = Depends(get_ads_service),
) -> AdCampaignRead:
    """Devuelve una campaña del tenant activo (404 si no existe)."""
    return service.get(tenant_id=tenant_id, ad_campaign_id=ad_campaign_id)


@router.patch("/{ad_campaign_id}", response_model=AdCampaignRead)
def update_ad_campaign(
    ad_campaign_id: uuid.UUID,
    data: AdCampaignUpdate,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: IAdsService = Depends(get_ads_service),
) -> AdCampaignRead:
    """Actualiza parcialmente una campaña (PATCH semantics)."""
    return service.update(
        tenant_id=tenant_id, ad_campaign_id=ad_campaign_id, data=data
    )


@router.delete("/{ad_campaign_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_ad_campaign(
    ad_campaign_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: IAdsService = Depends(get_ads_service),
) -> Response:
    """Soft-delete de una campaña (nunca borrado físico)."""
    service.delete(tenant_id=tenant_id, ad_campaign_id=ad_campaign_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
