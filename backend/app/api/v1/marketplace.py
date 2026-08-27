"""Endpoints del marketplace de templates de landings (Fase 8)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import (
    get_audit_service,
    get_current_tenant,
    get_landing_repository,
    get_marketplace_repository,
)
from app.core.errors import NotFoundError
from app.repositories.interfaces import ILandingRepository, IMarketplaceRepository
from app.schemas.common import Page, Pagination
from app.schemas.marketplace import (
    MarketplaceImportRequest,
    MarketplaceImportResponse,
    MarketplaceTemplateCreateRequest,
    MarketplaceTemplateRead,
)
from app.services.interfaces import IAuditService

router = APIRouter(prefix="/marketplace", tags=["marketplace"])


@router.get("/templates", response_model=Page[MarketplaceTemplateRead])
def list_templates(
    pagination: Pagination = Depends(),
    category: str | None = Query(default=None, max_length=64),
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: IMarketplaceRepository = Depends(get_marketplace_repository),
) -> Page[MarketplaceTemplateRead]:
    """Lista el catálogo de templates: públicos de cualquier tenant + propios.

    El catálogo es global de solo lectura; nunca se exponen templates privados
    de terceros (defensa en profundidad).
    """
    items, total = repository.list(
        tenant_id=tenant_id,
        page=pagination.page,
        page_size=pagination.page_size,
        category=category,
    )
    return Page(
        items=items,
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


@router.post(
    "/templates",
    response_model=MarketplaceTemplateRead,
    status_code=status.HTTP_201_CREATED,
)
def create_template(
    payload: MarketplaceTemplateCreateRequest,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: IMarketplaceRepository = Depends(get_marketplace_repository),
    audit: IAuditService = Depends(get_audit_service),
) -> MarketplaceTemplateRead:
    """Publica un template en el catálogo del marketplace (propio del tenant)."""
    template = repository.create(
        tenant_id=tenant_id,
        name=payload.name,
        description=payload.description,
        category=payload.category,
        config=payload.config,
        thumbnail_url=payload.thumbnail_url,
        is_public=payload.is_public,
    )
    audit.record(
        tenant_id=tenant_id,
        operation="marketplace.template.create",
        entity_type="marketplace_template",
        entity_id=str(template.id),
        details={
            "name": template.name,
            "category": template.category,
            "is_public": template.is_public,
        },
    )
    return MarketplaceTemplateRead.model_validate(template)


@router.post(
    "/templates/{template_id}/import",
    response_model=MarketplaceImportResponse,
    status_code=status.HTTP_201_CREATED,
)
def import_template(
    template_id: uuid.UUID,
    payload: MarketplaceImportRequest,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: IMarketplaceRepository = Depends(get_marketplace_repository),
    landings: ILandingRepository = Depends(get_landing_repository),
    audit: IAuditService = Depends(get_audit_service),
) -> MarketplaceImportResponse:
    """Importa un template del catálogo creando una landing en el tenant.

    La landing toma el ``config`` del template y (si no se indica) su nombre.
    El import incrementa el contador de descargas del template.
    """
    template = repository.get(tenant_id=tenant_id, template_id=template_id)
    if template is None:
        raise NotFoundError(
            message="Template de marketplace no encontrado para el tenant activo",
            operation="marketplace.template.import",
        )
    landing = landings.create(
        tenant_id=tenant_id,
        campaign_id=payload.campaign_id,
        name=payload.name or template.name,
        config=template.config,
    )
    repository.increment_downloads(tenant_id=tenant_id, template_id=template_id)
    audit.record(
        tenant_id=tenant_id,
        operation="marketplace.template.import",
        entity_type="tenant_landing",
        entity_id=str(landing.id),
        details={
            "template_id": str(template_id),
            "template_name": template.name,
        },
    )
    return MarketplaceImportResponse(
        template=MarketplaceTemplateRead.model_validate(template),
        landing_id=landing.id,
    )
