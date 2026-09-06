"""Endpoints de generación IA de JSON Schemas (Draft 2020-12) — Fase 5 del backlog."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends

from app.api.deps import (
    get_audit_service,
    get_current_tenant,
    get_schema_generation_service,
    get_schema_repository,
    require_role,
)
from app.models.base import utcnow
from app.models.user import Role
from app.repositories.interfaces import ISchemaRepository
from app.schemas.common import Page, Pagination
from app.schemas.schema import (
    DeveloperSchemaRead,
    SchemaGenerateRequest,
    SchemaGenerateResponse,
)
from app.services.interfaces import IAuditService, ISchemaGenerationService

router = APIRouter(
    prefix="/ai",
    tags=["ai"],
    dependencies=[Depends(require_role(Role.ADMIN, Role.CONFIGURADOR))],
)


@router.get("/schemas", response_model=Page[DeveloperSchemaRead])
def list_schemas(
    pagination: Pagination = Depends(),
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    schema_repository: ISchemaRepository = Depends(get_schema_repository),
) -> Page[DeveloperSchemaRead]:
    """Lista los JSON Schemas generados del tenant activo (paginado).

    El listado vive aquí porque pertenece al dominio de generación IA (Fase 5):
    lista lo que ``generate_schema`` produce. No compite con ``/schemas``
    (Fase 6-7), cuyo router solo cubre validación y versionado de un schema
    concreto (no expone listado), por lo que no hay ruta duplicada.
    """
    items, total = schema_repository.list(
        tenant_id=tenant_id, page=pagination.page, page_size=pagination.page_size
    )
    return Page(
        items=items,
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


@router.post("/generate-schema", response_model=SchemaGenerateResponse)
def generate_schema(
    data: SchemaGenerateRequest,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    schema_service: ISchemaGenerationService = Depends(get_schema_generation_service),
    audit: IAuditService = Depends(get_audit_service),
) -> SchemaGenerateResponse:
    """Genera un JSON Schema (Draft 2020-12) con IA (DeepSeek) y audita el uso."""
    result = schema_service.generate_schema(
        tenant_id=tenant_id, prompt=data.prompt, name=data.name
    )
    audit.record(
        tenant_id=tenant_id,
        operation="ai.generate_schema",
        entity_type="developer_schema",
        entity_id=None,
        details={
            "model": result.model,
            "cached": result.cached,
            "name": data.name or "auto",
            "prompt_tokens": result.prompt_tokens,
            "completion_tokens": result.completion_tokens,
        },
    )
    return SchemaGenerateResponse(
        schema=result.schema,
        model=result.model,
        cached=result.cached,
        prompt_tokens=result.prompt_tokens,
        completion_tokens=result.completion_tokens,
        generated_at=utcnow(),
    )
