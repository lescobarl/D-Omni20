"""Endpoints de apariencia del tenant (rebranding: paleta, logo y tipografía).

Incluye la extracción de estilos desde una URL de marca (Fase 5) y la gestión
de configuraciones de rebranding guardadas. Todos los endpoints requieren el
tenant activo vía ``X-Tenant-Id`` (``get_current_tenant``) y delegan en puertos
inyectados por ``Depends`` (regla CLAUDE: DI).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Response, status

from app.api.deps import (
    get_current_tenant,
    get_rebranding_config_repository,
    get_rebranding_service,
    get_tenant_appearance_repository,
    require_role,
)
from app.core.errors import NotFoundError
from app.models.user import Role, User
from app.repositories.interfaces import (
    IRebrandingConfigRepository,
    ITenantAppearanceRepository,
)
from app.schemas.tenant_config import (
    AppearanceProposal,
    ExtractUrlRequest,
    RebrandingConfigCreate,
    RebrandingConfigRead,
    TenantAppearanceRead,
    TenantAppearanceUpsert,
)
from app.services.interfaces import IRebrandingService

router = APIRouter(prefix="/tenant/appearance", tags=["tenant-appearance"])


@router.get("", response_model=TenantAppearanceRead)
def get_appearance(
    _auth: User = Depends(require_role(Role.ADMIN, Role.CONFIGURADOR)),
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: ITenantAppearanceRepository = Depends(get_tenant_appearance_repository),
) -> TenantAppearanceRead:
    """Devuelve la apariencia vigente del tenant (404 si no está definida)."""
    row = repository.get(tenant_id=tenant_id)
    if row is None:
        raise NotFoundError(
            "Apariencia no definida para el tenant activo",
            operation="tenant.appearance.get",
            context={"tenant_id": str(tenant_id)},
        )
    return TenantAppearanceRead.model_validate(row)


@router.put("", response_model=TenantAppearanceRead)
def upsert_appearance(
    data: TenantAppearanceUpsert,
    _auth: User = Depends(require_role(Role.ADMIN, Role.CONFIGURADOR)),
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: ITenantAppearanceRepository = Depends(get_tenant_appearance_repository),
) -> TenantAppearanceRead:
    """Crea o reemplaza la apariencia del tenant (una sola fila por tenant)."""
    row = repository.upsert(
        tenant_id=tenant_id,
        primary_color=data.primary_color,
        accent_color=data.accent_color,
        surface_color=data.surface_color,
        text_color=data.text_color,
        brand_badge=data.brand_badge,
        logo_url=data.logo_url,
        font_family=data.font_family,
    )
    return TenantAppearanceRead.model_validate(row)


@router.post("/extract-url", response_model=AppearanceProposal)
def extract_url_styles(
    data: ExtractUrlRequest,
    _auth: User = Depends(require_role(Role.ADMIN, Role.CONFIGURADOR)),
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    rebranding: IRebrandingService = Depends(get_rebranding_service),
) -> AppearanceProposal:
    """Analiza una URL de marca y propone paleta, tipografías y logo (sin persistir)."""
    return rebranding.extract_url_styles(url=data.url)


@router.get("/rebranding", response_model=list[RebrandingConfigRead])
def list_rebranding_configs(
    _auth: User = Depends(require_role(Role.ADMIN, Role.CONFIGURADOR)),
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: IRebrandingConfigRepository = Depends(get_rebranding_config_repository),
) -> list[RebrandingConfigRead]:
    """Lista las configuraciones de rebranding guardadas del tenant."""
    rows = repository.list_all(tenant_id=tenant_id)
    return [RebrandingConfigRead.model_validate(row) for row in rows]


@router.post(
    "/rebranding",
    response_model=RebrandingConfigRead,
    status_code=status.HTTP_201_CREATED,
)
def create_rebranding_config(
    data: RebrandingConfigCreate,
    _auth: User = Depends(require_role(Role.ADMIN, Role.CONFIGURADOR)),
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    rebranding: IRebrandingService = Depends(get_rebranding_service),
    repository: IRebrandingConfigRepository = Depends(get_rebranding_config_repository),
    appearance_repository: ITenantAppearanceRepository = Depends(
        get_tenant_appearance_repository
    ),
) -> RebrandingConfigRead:
    """Guarda una configuración de rebranding.

    Si ``data.url`` se proporciona, extrae los estilos de esa URL de marca. Si se
    omite (``None``), guarda una instantánea de los estilos actuales del tenant
    como backup (GAP 3) — sin llamadas de red.
    """
    if data.url is not None:
        proposal = rebranding.extract_url_styles(url=data.url)
        extracted = proposal.model_dump()
    else:
        current = appearance_repository.get(tenant_id=tenant_id)
        if current is None:
            raise NotFoundError(
                "No hay apariencia vigente para guardar como backup",
                operation="tenant.appearance.create_rebranding",
                context={"tenant_id": str(tenant_id)},
            )
        extracted = {
            "primary_color": current.primary_color,
            "accent_color": current.accent_color,
            "surface_color": current.surface_color,
            "text_color": current.text_color,
            "brand_badge": current.brand_badge,
            "logo_url": current.logo_url,
            "font_family": current.font_family,
            "detected_fonts": [current.font_family] if current.font_family else [],
            "source": "snapshot",
        }
    row = repository.create(
        tenant_id=tenant_id,
        name=data.name,
        url=data.url or "",
        extracted=extracted,
        applied_at=datetime.now(timezone.utc),
    )
    return RebrandingConfigRead.model_validate(row)


@router.delete("/rebranding/{config_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_rebranding_config(
    config_id: uuid.UUID,
    _auth: User = Depends(require_role(Role.ADMIN, Role.CONFIGURADOR)),
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: IRebrandingConfigRepository = Depends(get_rebranding_config_repository),
) -> Response:
    """Elimina (soft-delete) una configuración de rebranding del tenant."""
    if not repository.soft_delete(tenant_id=tenant_id, config_id=config_id):
        raise NotFoundError(
            "Configuración de rebranding no encontrada",
            operation="tenant.appearance.delete_rebranding",
            context={"tenant_id": str(tenant_id), "config_id": str(config_id)},
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
