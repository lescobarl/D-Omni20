"""Endpoints de la matriz programática PSEO (Fase B): resolución + compilación."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, status

from app.api.deps import (
    get_current_tenant,
    get_data_matrix_service,
    get_landing_repository,
    get_pseo_service,
)
from app.core.errors import NotFoundError
from app.repositories.interfaces import ILandingRepository
from app.schemas.generator import (
    MatrixPageResult,
    MatrixUploadRequest,
    MatrixUploadResponse,
)
from app.services.interfaces import IDataMatrixService, IPseoService, MatrixRowData

router = APIRouter(prefix="/generator", tags=["generator"])


@router.post(
    "/matrix-upload/{campaign_id}",
    response_model=MatrixUploadResponse,
    status_code=status.HTTP_201_CREATED,
)
def matrix_upload(
    campaign_id: uuid.UUID,
    payload: MatrixUploadRequest,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    landing_repository: ILandingRepository = Depends(get_landing_repository),
    service: IDataMatrixService = Depends(get_data_matrix_service),
    pseo_service: IPseoService = Depends(get_pseo_service),
) -> MatrixUploadResponse:
    """Carga una matriz programática y la resuelve contra la config base.

    - ``campaign_id`` debe pertenecer al tenant activo (consulta
      ``tenant_landings.campaign_id``); si no → 404 (sin filtrar existencia de
      la campaña, sin fuga cross-tenant).
    - Cada fila se resuelve (sustitución estricta por whitelist + escape) y,
      opcionalmente, se compila con la plantilla ``pseo`` (anti-SSTI / anti-XSS).
    - Si ``compile`` es ``True``, la matriz se persiste de forma versionada e
      idempotente (Fase D): re-ejecutar la misma matriz no crea versiones nuevas.
    - Auditoría: ``matrix.upload`` y ``batch.compile`` (+ ``pseo.batch.persist``).
    """
    if (
        landing_repository.get_by_campaign(
            tenant_id=tenant_id, campaign_id=campaign_id
        )
        is None
    ):
        raise NotFoundError(
            "Campaña no encontrada para el tenant activo",
            operation="matrix.upload",
            context={"tenant_id": str(tenant_id), "campaign_id": str(campaign_id)},
        )

    rows = [
        MatrixRowData(
            city=row.city,
            service_slug=row.service_slug,
            service_name=row.service_name,
            offer_price=row.offer_price,
        )
        for row in payload.rows
    ]
    pages = service.process_matrix(
        tenant_id=tenant_id,
        campaign_id=campaign_id,
        template_config=payload.template_config,
        rows=rows,
        compile_pages=payload.compile,
    )
    if payload.compile:
        pseo_service.persist_matrix(
            tenant_id=tenant_id,
            campaign_id=campaign_id,
            template_config=payload.template_config,
            resolved_pages=pages,
        )
    return MatrixUploadResponse(
        tenant_id=tenant_id,
        campaign_id=campaign_id,
        total_rows=len(rows),
        resolved_rows=len(pages),
        pages=[
            MatrixPageResult(
                city=page.city,
                service_slug=page.service_slug,
                service_name=page.service_name,
                offer_price=page.offer_price,
                config=page.config,
                html=page.html,
            )
            for page in pages
        ],
        compiled_at=datetime.now(timezone.utc) if payload.compile else None,
    )
