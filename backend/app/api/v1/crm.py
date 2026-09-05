"""Endpoints del subsistema CRM (pipeline, tareas, SLA, embudo y resumen).

Todos los endpoints requieren el tenant activo vía ``X-Tenant-Id``
(``get_current_tenant``) y delegan en :class:`ICrmService` (puerto inyectado
por ``Depends`` — regla CLAUDE: DI). El diseño sigue ``PLAN_CRM_E2E_Y_UX``:

- Mover un deal a una etapa terminal lo cierra según ``outcome`` (won/lost).
- Las tareas pueden crearse sueltas (``POST /crm/tasks``) o vinculadas a una
  oportunidad (``POST /crm/deals/{deal_id}/tasks``).
- ``GET /crm/summary`` es el contrato del Portal del Cliente (P4) por email.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, Response, status

from app.api.deps import get_crm_service, get_current_tenant, require_role
from app.models.user import Role
from app.schemas.common import Page, Pagination
from app.schemas.crm import (
    CrmSummaryRead,
    DealCreate,
    DealRead,
    DealUpdate,
    FunnelRead,
    SlaRead,
    SlaUpsert,
    StageChangeRead,
    StageCreate,
    StageRead,
    StageUpdate,
    TaskCreate,
    TaskRead,
    TaskUpdate,
)
from app.services.interfaces import ICrmService

router = APIRouter(
    prefix="/crm",
    tags=["crm"],
    dependencies=[Depends(require_role(Role.ADMIN, Role.OPERADOR))],
)


# ────────────────────────────────────────────────────────────────────────────
# Etapas del pipeline (M1)
# ────────────────────────────────────────────────────────────────────────────
@router.get("/stages", response_model=list[StageRead])
def list_stages(
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: ICrmService = Depends(get_crm_service),
) -> list[StageRead]:
    """Lista las etapas del pipeline del tenant activo (ordenadas por ``order``)."""
    return service.list_stages(tenant_id=tenant_id)


@router.post("/stages", response_model=StageRead, status_code=status.HTTP_201_CREATED)
def create_stage(
    data: StageCreate,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: ICrmService = Depends(get_crm_service),
) -> StageRead:
    """Crea una etapa del pipeline (única por tenant+nombre)."""
    return service.create_stage(tenant_id=tenant_id, data=data)


@router.get("/stages/{stage_id}", response_model=StageRead)
def get_stage(
    stage_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: ICrmService = Depends(get_crm_service),
) -> StageRead:
    """Devuelve una etapa del tenant activo (404 si no existe)."""
    return service.get_stage(tenant_id=tenant_id, stage_id=stage_id)


@router.patch("/stages/{stage_id}", response_model=StageRead)
def update_stage(
    stage_id: uuid.UUID,
    data: StageUpdate,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: ICrmService = Depends(get_crm_service),
) -> StageRead:
    """Actualiza parcialmente una etapa (PATCH semantics)."""
    return service.update_stage(tenant_id=tenant_id, stage_id=stage_id, data=data)


@router.delete("/stages/{stage_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_stage(
    stage_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: ICrmService = Depends(get_crm_service),
) -> Response:
    """Soft-delete de una etapa (bloqueado si tiene oportunidades asociadas)."""
    service.delete_stage(tenant_id=tenant_id, stage_id=stage_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ────────────────────────────────────────────────────────────────────────────
# Oportunidades (M1)
# ────────────────────────────────────────────────────────────────────────────
@router.get("/deals", response_model=Page[DealRead])
def list_deals(
    pagination: Pagination = Depends(),
    stage_id: uuid.UUID | None = None,
    owner_id: uuid.UUID | None = None,
    status_: str | None = Query(default=None, alias="status"),
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: ICrmService = Depends(get_crm_service),
) -> Page[DealRead]:
    """Lista oportunidades del tenant activo (filtros opcionales + paginado)."""
    return service.list_deals(
        tenant_id=tenant_id,
        page=pagination.page,
        page_size=pagination.page_size,
        stage_id=stage_id,
        owner_id=owner_id,
        status=status_,
    )


@router.post("/deals", response_model=DealRead, status_code=status.HTTP_201_CREATED)
def create_deal(
    data: DealCreate,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: ICrmService = Depends(get_crm_service),
) -> DealRead:
    """Crea una oportunidad en el pipeline (bloqueada en etapas terminales)."""
    return service.create_deal(tenant_id=tenant_id, data=data)


@router.get("/deals/{deal_id}", response_model=DealRead)
def get_deal(
    deal_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: ICrmService = Depends(get_crm_service),
) -> DealRead:
    """Devuelve una oportunidad del tenant activo (404 si no existe)."""
    return service.get_deal(tenant_id=tenant_id, deal_id=deal_id)


@router.patch("/deals/{deal_id}", response_model=DealRead)
def update_deal(
    deal_id: uuid.UUID,
    data: DealUpdate,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: ICrmService = Depends(get_crm_service),
) -> DealRead:
    """Actualiza parcialmente una oportunidad (incluye mover de etapa)."""
    return service.update_deal(tenant_id=tenant_id, deal_id=deal_id, data=data)


@router.delete("/deals/{deal_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_deal(
    deal_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: ICrmService = Depends(get_crm_service),
) -> Response:
    """Soft-delete de una oportunidad (nunca borrado físico)."""
    service.delete_deal(tenant_id=tenant_id, deal_id=deal_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/deals/{deal_id}/history", response_model=list[StageChangeRead])
def list_deal_history(
    deal_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: ICrmService = Depends(get_crm_service),
) -> list[StageChangeRead]:
    """Historial append-only de movimientos de etapa de una oportunidad."""
    return service.list_history(tenant_id=tenant_id, deal_id=deal_id)


@router.get("/deals/{deal_id}/tasks", response_model=Page[TaskRead])
def list_deal_tasks(
    deal_id: uuid.UUID,
    pagination: Pagination = Depends(),
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: ICrmService = Depends(get_crm_service),
) -> Page[TaskRead]:
    """Lista las tareas de seguimiento de una oportunidad (paginado)."""
    return service.list_tasks(
        tenant_id=tenant_id,
        page=pagination.page,
        page_size=pagination.page_size,
        deal_id=deal_id,
    )


@router.post(
    "/deals/{deal_id}/tasks",
    response_model=TaskRead,
    status_code=status.HTTP_201_CREATED,
)
def create_deal_task(
    deal_id: uuid.UUID,
    data: TaskCreate,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: ICrmService = Depends(get_crm_service),
) -> TaskRead:
    """Crea una tarea vinculada a una oportunidad (``deal_id`` del path)."""
    return service.create_task(
        tenant_id=tenant_id, data=data.model_copy(update={"deal_id": deal_id})
    )


# ────────────────────────────────────────────────────────────────────────────
# Tareas (M2)
# ────────────────────────────────────────────────────────────────────────────
@router.get("/tasks", response_model=Page[TaskRead])
def list_tasks(
    pagination: Pagination = Depends(),
    deal_id: uuid.UUID | None = None,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: ICrmService = Depends(get_crm_service),
) -> Page[TaskRead]:
    """Lista tareas del tenant activo (filtro por deal opcional + paginado)."""
    return service.list_tasks(
        tenant_id=tenant_id,
        page=pagination.page,
        page_size=pagination.page_size,
        deal_id=deal_id,
    )


@router.post("/tasks", response_model=TaskRead, status_code=status.HTTP_201_CREATED)
def create_task(
    data: TaskCreate,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: ICrmService = Depends(get_crm_service),
) -> TaskRead:
    """Crea una tarea de seguimiento del tenant activo."""
    return service.create_task(tenant_id=tenant_id, data=data)


@router.get("/tasks/{task_id}", response_model=TaskRead)
def get_task(
    task_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: ICrmService = Depends(get_crm_service),
) -> TaskRead:
    """Devuelve una tarea del tenant activo (404 si no existe)."""
    return service.get_task(tenant_id=tenant_id, task_id=task_id)


@router.patch("/tasks/{task_id}", response_model=TaskRead)
def update_task(
    task_id: uuid.UUID,
    data: TaskUpdate,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: ICrmService = Depends(get_crm_service),
) -> TaskRead:
    """Actualiza parcialmente una tarea (PATCH semantics)."""
    return service.update_task(tenant_id=tenant_id, task_id=task_id, data=data)


@router.delete("/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(
    task_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: ICrmService = Depends(get_crm_service),
) -> Response:
    """Soft-delete de una tarea (nunca borrado físico)."""
    service.delete_task(tenant_id=tenant_id, task_id=task_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ────────────────────────────────────────────────────────────────────────────
# SLA (M5)
# ────────────────────────────────────────────────────────────────────────────
@router.get("/sla", response_model=list[SlaRead])
def list_sla(
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: ICrmService = Depends(get_crm_service),
) -> list[SlaRead]:
    """Lista las políticas de SLA del tenant activo (una por etapa)."""
    return service.list_sla(tenant_id=tenant_id)


@router.put("/sla", response_model=SlaRead)
def upsert_sla(
    data: SlaUpsert,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: ICrmService = Depends(get_crm_service),
) -> SlaRead:
    """Crea o actualiza la política de SLA de una etapa (upsert)."""
    return service.upsert_sla(tenant_id=tenant_id, data=data)


# ────────────────────────────────────────────────────────────────────────────
# Reportes
# ────────────────────────────────────────────────────────────────────────────
@router.get("/funnel", response_model=FunnelRead)
def get_funnel(
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: ICrmService = Depends(get_crm_service),
) -> FunnelRead:
    """Reporte del embudo comercial del tenant activo (M4)."""
    return service.funnel(tenant_id=tenant_id)


# ────────────────────────────────────────────────────────────────────────────
# Resumen del portal del cliente (P4)
# ────────────────────────────────────────────────────────────────────────────
@router.get("/summary", response_model=CrmSummaryRead)
def get_summary(
    email: str,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: ICrmService = Depends(get_crm_service),
) -> CrmSummaryRead:
    """Resumen de oportunidades de un cliente por email (contrato del portal P4)."""
    return service.summary(tenant_id=tenant_id, email=email)
