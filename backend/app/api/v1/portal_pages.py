"""Endpoints del configurador de páginas del Portal del Cliente (CRUD + publicar + IA).

Todos los endpoints requieren el tenant activo vía ``X-Tenant-Id``
(``get_current_tenant``) y delegan en :class:`IPortalPageService` (puerto
inyectado por ``Depends`` — regla CLAUDE: DI).

El prefijo es ``/portal-pages`` para no colisionar con el router cliente
``/portal`` (API de autoservicio del Portal del Cliente, C-3).
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response, status

from app.api.deps import (
    get_ai_service,
    get_audit_service,
    get_current_tenant,
    get_portal_page_service,
    require_role,
)
from app.models.base import utcnow
from app.models.user import Role
from app.schemas.common import Page, Pagination
from app.schemas.portal_page import (
    PortalPageAiGenerationRequest,
    PortalPageAiGenerationResponse,
    PortalPageCreate,
    PortalPagePublishRequest,
    PortalPageRead,
    PortalPageUpdate,
)
from app.services.interfaces import IAiService, IAuditService, IPortalPageService

router = APIRouter(
    prefix="/portal-pages",
    tags=["portal-pages"],
    dependencies=[Depends(require_role(Role.ADMIN, Role.CONFIGURADOR))],
)


@router.get("", response_model=Page[PortalPageRead])
def list_portal_pages(
    pagination: Pagination = Depends(),
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: IPortalPageService = Depends(get_portal_page_service),
) -> Page[PortalPageRead]:
    """Lista las páginas del portal del tenant activo (paginado)."""
    return service.list(
        tenant_id=tenant_id, page=pagination.page, page_size=pagination.page_size
    )


@router.post("", response_model=PortalPageRead, status_code=status.HTTP_201_CREATED)
def create_portal_page(
    data: PortalPageCreate,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: IPortalPageService = Depends(get_portal_page_service),
) -> PortalPageRead:
    """Crea una página del portal (unique por tenant+slug)."""
    return service.create(tenant_id=tenant_id, data=data)


@router.get("/{page_id}", response_model=PortalPageRead)
def get_portal_page(
    page_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: IPortalPageService = Depends(get_portal_page_service),
) -> PortalPageRead:
    """Devuelve una página del portal del tenant activo (404 si no existe)."""
    return service.get(tenant_id=tenant_id, page_id=page_id)


@router.patch("/{page_id}", response_model=PortalPageRead)
def update_portal_page(
    page_id: uuid.UUID,
    data: PortalPageUpdate,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: IPortalPageService = Depends(get_portal_page_service),
) -> PortalPageRead:
    """Actualiza parcialmente una página del portal (PATCH semantics)."""
    return service.update(tenant_id=tenant_id, page_id=page_id, data=data)


@router.delete("/{page_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_portal_page(
    page_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: IPortalPageService = Depends(get_portal_page_service),
) -> Response:
    """Soft-delete de una página del portal (nunca borrado físico)."""
    service.delete(tenant_id=tenant_id, page_id=page_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{page_id}/publish", response_model=PortalPageRead)
def publish_portal_page(
    page_id: uuid.UUID,
    data: PortalPagePublishRequest,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: IPortalPageService = Depends(get_portal_page_service),
) -> PortalPageRead:
    """Publica o despublica una página del portal del tenant activo."""
    return service.publish(
        tenant_id=tenant_id, page_id=page_id, published=data.published
    )


@router.post("/generate", response_model=PortalPageAiGenerationResponse)
def generate_portal_page(
    data: PortalPageAiGenerationRequest,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    ai_service: IAiService = Depends(get_ai_service),
    audit: IAuditService = Depends(get_audit_service),
) -> PortalPageAiGenerationResponse:
    """Genera la configuración de una página del portal con IA (DeepSeek) y audita el uso.

    Reutiliza el mismo motor de generación que la landing (UN configurador
    basado en IA generativa).
    """
    result = ai_service.generate_portal(
        tenant_id=tenant_id,
        prompt=data.prompt,
        brand_voice=data.brand_voice,
    )
    audit.record(
        tenant_id=tenant_id,
        operation="ai.generate_portal",
        entity_type="portal_page",
        entity_id=None,
        details={
            "model": result.model,
            "cached": result.cached,
            "has_brand_voice": data.brand_voice is not None,
            "prompt_tokens": result.prompt_tokens,
            "completion_tokens": result.completion_tokens,
        },
    )
    config = result.config
    return PortalPageAiGenerationResponse(
        slug=str(config.get("slug") or "inicio"),
        title=str(config.get("title") or "Página del portal"),
        blocks=config,
        model=result.model,
        cached=result.cached,
        brand_voice=data.brand_voice,
        prompt_tokens=result.prompt_tokens,
        completion_tokens=result.completion_tokens,
        generated_at=utcnow(),
    )
