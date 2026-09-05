"""Endpoints de consulta del log de auditoría (solo lectura, por tenant)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends

from app.api.deps import get_audit_service, get_current_tenant, require_role
from app.models.user import Role
from app.schemas.audit import AuditLogRead
from app.schemas.common import Page, Pagination
from app.services.interfaces import IAuditService

router = APIRouter(
    prefix="/audit",
    tags=["audit"],
    dependencies=[Depends(require_role(Role.ADMIN, Role.OPERADOR))],
)


@router.get("", response_model=Page[AuditLogRead])
def list_audit_logs(
    pagination: Pagination = Depends(),
    operation: str | None = None,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    service: IAuditService = Depends(get_audit_service),
) -> Page[AuditLogRead]:
    """Lista las entradas de auditoría del tenant activo (paginado, opcional filtro)."""
    return service.list(
        tenant_id=tenant_id,
        page=pagination.page,
        page_size=pagination.page_size,
        operation=operation,
    )
