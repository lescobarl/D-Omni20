"""Serving público PSEO (Fase D): ``GET /pseo/{slug_path}`` + sitemap paginado.

Contrato:
- Rutas raíz (sin ``api_v1_prefix``) porque son públicas: se sirven desde el
  dominio del cliente sin ``X-Tenant-Id``.
- El tenant se resuelve SIEMPRE por la cabecera ``Host`` contra ``pseo_hosts``
  (vía ``get_pseo_tenant_by_host``). Host ausente/desconocido → 404, sin leak.
- ``serve_page`` devuelve el HTML compilado tal cual (ya pre-escapado por
  ``DataMatrixService`` — sin doble escape). Página de otro tenant → 404.
- Sitemap: si hay ≤ 1000 páginas se emite un ``urlset`` único en
  ``/sitemap.xml``; si hay más, ``/sitemap.xml`` es un ``sitemapindex`` con
  chunks de 1000 URLs en ``/sitemap-{index}.xml`` (todo acotado al tenant
  resuelto por ``Host``).
"""

from __future__ import annotations

import math
import uuid
from xml.sax.saxutils import escape as escape_xml

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import HTMLResponse

from app.api.deps import get_pseo_service, get_pseo_tenant_by_host
from app.core.errors import NotFoundError
from app.services.interfaces import IPseoService

router = APIRouter(tags=["pseo"])

_PAGE_SIZE = 1000
_XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>\n'


def _xml_response(content: str) -> Response:
    """Respuesta XML con media type correcto para sitemaps."""
    return Response(content=content, media_type="application/xml")


def _site_base_url(request: Request) -> str:
    """URL base del sitio (scheme + Host) para construir LOC absolutos."""
    host = request.headers.get("host", "").strip()
    scheme = request.url.scheme
    return f"{scheme}://{host}" if host else ""


def _single_sitemap(
    request: Request,
    tenant_id: uuid.UUID,
    service: IPseoService,
    *,
    offset: int,
    limit: int,
) -> Response:
    """``urlset`` con un chunk (hasta ``limit``) de páginas publicadas del tenant."""
    pages = service.sitemap_pages(tenant_id=tenant_id, offset=offset, limit=limit)
    base = _site_base_url(request)
    urls: list[str] = []
    for page in pages:
        loc = page.canonical_url or f"{base}/{page.slug_path}"
        lastmod = page.updated_at.date().isoformat() if page.updated_at else ""
        urls.append(
            f"<url><loc>{escape_xml(loc)}</loc>"
            f"<lastmod>{escape_xml(lastmod)}</lastmod></url>"
        )
    content = (
        _XML_HEADER
        + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "".join(urls)
        + "\n</urlset>"
    )
    return _xml_response(content)


@router.get("/pseo/{slug_path:path}")
def serve_page(
    slug_path: str,
    tenant_id: uuid.UUID = Depends(get_pseo_tenant_by_host),
    service: IPseoService = Depends(get_pseo_service),
) -> HTMLResponse:
    """Sirve el HTML compilado de una página PSEO del tenant resuelto por ``Host``.

    - Página inexistente o de otro tenant → 404 (sin distinguir el motivo).
    - El HTML ya viene pre-escapado por ``DataMatrixService``; no se re-escapa.
    """
    page = service.serve_page(tenant_id=tenant_id, slug_path=slug_path)
    if page is None:
        raise NotFoundError(
            "Página PSEO no encontrada",
            operation="pseo.serve",
            context={"tenant_id": str(tenant_id), "slug_path": slug_path},
        )
    return HTMLResponse(content=page.compiled_html)


@router.get("/sitemap.xml")
def sitemap_xml(
    request: Request,
    tenant_id: uuid.UUID = Depends(get_pseo_tenant_by_host),
    service: IPseoService = Depends(get_pseo_service),
) -> Response:
    """Sitemap del tenant: ``urlset`` único (≤1000) o ``sitemapindex`` paginado."""
    total = service.count_pages(tenant_id=tenant_id)
    if total <= _PAGE_SIZE:
        return _single_sitemap(
            request, tenant_id, service, offset=0, limit=_PAGE_SIZE
        )

    chunk_count = math.ceil(total / _PAGE_SIZE)
    base = _site_base_url(request)
    entries = "".join(
        f"<sitemap><loc>{escape_xml(f'{base}/sitemap-{idx}.xml')}</loc></sitemap>"
        for idx in range(1, chunk_count + 1)
    )
    content = (
        _XML_HEADER
        + '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + entries
        + "\n</sitemapindex>"
    )
    return _xml_response(content)


@router.get("/sitemap-{index}.xml")
def sitemap_chunk_xml(
    index: int,
    request: Request,
    tenant_id: uuid.UUID = Depends(get_pseo_tenant_by_host),
    service: IPseoService = Depends(get_pseo_service),
) -> Response:
    """Chunk de 1000 URLs del sitemap paginado (índice 1-based)."""
    total = service.count_pages(tenant_id=tenant_id)
    chunk_count = max(1, math.ceil(total / _PAGE_SIZE))
    if index < 1 or index > chunk_count:
        raise NotFoundError(
            "Chunk de sitemap no encontrado",
            operation="pseo.sitemap",
            context={"tenant_id": str(tenant_id), "index": index},
        )
    return _single_sitemap(
        request,
        tenant_id,
        service,
        offset=(index - 1) * _PAGE_SIZE,
        limit=_PAGE_SIZE,
    )
