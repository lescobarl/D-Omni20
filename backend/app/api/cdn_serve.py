"""Serving público de landings desplegadas al CDN (Fase 10).

Contrato:
- Ruta raíz (sin ``api_v1_prefix``) porque es pública: se sirve desde el dominio
  del cliente sin ``X-Tenant-Id``, en la URL determinista
  ``{cdn_base_url}/{landing_id}/v{version}`` (p. ej.
  ``http://localhost:8000/cdn/{landing_id}/v{version}``).
- URL amigable por slug: ``GET /l/{slug}`` resuelve el tenant por ``Host`` y
  sirve la landing publicada con ese slug (última versión desplegada al CDN).
  Cada landing tiene su propia URL amigable (p. ej.
  ``http://escobar.clientes.omni2.app:8000/l/casa-vista-lago-tequesquitengo``).
- La raíz ``GET /`` NO sirve una landing directamente: redirige al Portal del
  Cliente (``/portal``). La landing inicial tiene su propia URL amigable.
- El tenant se resuelve SIEMPRE por la cabecera ``Host`` contra ``pseo_hosts``
  (vía ``get_pseo_tenant_by_host``), igual que el serving PSEO. Host
  ausente/desconocido → 404, sin leak.
- ``serve_deployment`` devuelve el HTML compilado de la versión solicitada tal
  cual (ya pre-escapado por el compilador). Versión inexistente o de otro tenant
  → 404 (sin distinguir el motivo).
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from app.api.deps import (
    get_cdn_deployment_repository,
    get_cdn_deployment_service,
    get_landing_repository,
    get_pseo_tenant_by_host,
)
from app.api.http import request_origin
from app.core.errors import NotFoundError
from app.repositories.interfaces import ICdnDeploymentRepository, ILandingRepository
from app.services.interfaces import ICdnDeploymentService

router = APIRouter(tags=["cdn-serve"])


@router.get("/cdn/{landing_id}/v{version}")
def serve_deployment(
    landing_id: uuid.UUID,
    version: int,
    request: Request,
    tenant_id: uuid.UUID = Depends(get_pseo_tenant_by_host),
    service: ICdnDeploymentService = Depends(get_cdn_deployment_service),
) -> HTMLResponse:
    """Sirve el HTML compilado de una versión de landing del tenant por ``Host``.

    - Versión inexistente o de otro tenant → 404 (sin distinguir el motivo).
    - El HTML ya viene pre-escapado por el compilador; no se re-escapa.
    - El ``apiBaseUrl`` del ``#omnibotia-config`` se reescribe al origen del
      request (localhost, túnel ngrok o dominio real) para que el widget apunte
      al mismo origen que sirvió la página.
    """
    origin = request_origin(request)
    try:
        html = service.serve(
            tenant_id=tenant_id,
            landing_id=landing_id,
            version=version,
            origin=origin,
        )
    except NotFoundError:
        raise NotFoundError(
            "Landing no encontrada en el CDN",
            operation="cdn.serve",
            context={
                "tenant_id": str(tenant_id),
                "landing_id": str(landing_id),
                "version": version,
            },
        )
    return HTMLResponse(content=html)


@router.get("/", response_model=None)
def serve_tenant_root(
    request: Request,
    tenant_id: uuid.UUID = Depends(get_pseo_tenant_by_host),
) -> RedirectResponse:
    """Redirige la raíz del subdominio al Portal del Cliente.

    La raíz (``GET /``) NO sirve una landing directamente: cada landing tiene su
    propia URL amigable en ``GET /l/{slug}``. La raíz redirige al Portal del
    Cliente (``/portal``), que es el punto de entrada del tenant.
    """
    return RedirectResponse(url="/portal", status_code=307)


@router.get("/l/{slug}", response_model=None)
def serve_landing_by_slug(
    slug: str,
    request: Request,
    tenant_id: uuid.UUID = Depends(get_pseo_tenant_by_host),
    landing_repo: ILandingRepository = Depends(get_landing_repository),
    cdn_repo: ICdnDeploymentRepository = Depends(get_cdn_deployment_repository),
    service: ICdnDeploymentService = Depends(get_cdn_deployment_service),
) -> HTMLResponse:
    """Sirve la landing publicada del tenant por su URL amigable (slug).

    ``GET /l/{slug}`` resuelve el tenant por ``Host`` y sirve la landing con ese
    slug (última versión desplegada al CDN). Si la landing no existe, no está
    publicada o no tiene despliegue → 404 (sin distinguir el motivo).
    """
    landing = landing_repo.get_by_slug(tenant_id=tenant_id, slug=slug)
    if landing is None or not landing.published:
        raise NotFoundError(
            "Landing no encontrada",
            operation="cdn.serve.slug",
            context={"tenant_id": str(tenant_id), "slug": slug},
        )

    deployment = cdn_repo.get_latest(tenant_id=tenant_id, landing_id=landing.id)
    if deployment is None:
        raise NotFoundError(
            "Landing publicada sin despliegue en el CDN",
            operation="cdn.serve.slug",
            context={"tenant_id": str(tenant_id), "landing_id": str(landing.id)},
        )

    origin = request_origin(request)
    html = service.serve(
        tenant_id=tenant_id,
        landing_id=landing.id,
        version=deployment.version,
        origin=origin,
    )
    return HTMLResponse(content=html)
