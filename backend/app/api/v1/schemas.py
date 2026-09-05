"""Endpoints de JSON Schemas (Draft 2020-12): validación (Fase 6) y versionado (Fase 7)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, status

from app.api.deps import (
    get_audit_service,
    get_current_tenant,
    get_schema_repository,
    get_schema_validator,
    get_schema_version_repository,
    require_role,
)
from app.core.errors import NotFoundError
from app.models.user import Role
from app.repositories.interfaces import (
    ISchemaRepository,
    ISchemaVersionRepository,
)
from app.schemas.common import Page, Pagination
from app.schemas.schema import (
    SchemaValidateRequest,
    SchemaValidateResponse,
    SchemaValidationIssue,
    SchemaVersionCreateRequest,
    SchemaVersionRead,
)
from app.services.interfaces import IAuditService, ISchemaValidator

router = APIRouter(
    prefix="/schemas",
    tags=["schemas"],
    dependencies=[Depends(require_role(Role.ADMIN, Role.CONFIGURADOR))],
)


@router.post("/validate", response_model=SchemaValidateResponse)
def validate_schema(
    payload: SchemaValidateRequest,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    validator: ISchemaValidator = Depends(get_schema_validator),
    audit: IAuditService = Depends(get_audit_service),
) -> SchemaValidateResponse:
    """Valida un JSON Schema (Draft 2020-12) y, opcionalmente, datos contra él.

    Devuelve ``valid``, el número de errores y la lista de incumplimientos
    (ruta del dato, mensaje y keyword de JSON Schema implicada).
    """
    result = validator.validate(schema=payload.schema, data=payload.data)
    audit.record(
        tenant_id=tenant_id,
        operation="schemas.validate",
        entity_type="developer_schema",
        details={"valid": result.valid, "errors": result.errors},
    )
    return SchemaValidateResponse(
        valid=result.valid,
        errors=result.errors,
        issues=[
            SchemaValidationIssue(
                path=issue.path,
                message=issue.message,
                keyword=issue.keyword,
            )
            for issue in result.issues
        ],
    )


@router.get("/{schema_id}/versions", response_model=Page[SchemaVersionRead])
def list_schema_versions(
    schema_id: uuid.UUID,
    pagination: Pagination = Depends(),
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    schema_repository: ISchemaRepository = Depends(get_schema_repository),
    versions_repository: ISchemaVersionRepository = Depends(
        get_schema_version_repository
    ),
) -> Page[SchemaVersionRead]:
    """Lista los snapshots versionados de un JSON Schema del tenant (paginado).

    Devuelve 404 si el schema no existe o pertenece a otro tenant.
    """
    schema = schema_repository.get(tenant_id=tenant_id, schema_id=schema_id)
    if schema is None:
        raise NotFoundError(
            message="JSON Schema no encontrado para el tenant activo",
            operation="schemas.versions.list",
        )
    items, total = versions_repository.list_versions(
        tenant_id=tenant_id,
        schema_id=schema_id,
        page=pagination.page,
        page_size=pagination.page_size,
    )
    return Page(
        items=items,
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


@router.post(
    "/{schema_id}/versions",
    response_model=SchemaVersionRead,
    status_code=status.HTTP_201_CREATED,
)
def create_schema_version(
    schema_id: uuid.UUID,
    payload: SchemaVersionCreateRequest,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    schema_repository: ISchemaRepository = Depends(get_schema_repository),
    versions_repository: ISchemaVersionRepository = Depends(
        get_schema_version_repository
    ),
    audit: IAuditService = Depends(get_audit_service),
) -> SchemaVersionRead:
    """Congela el estado actual de un JSON Schema en una nueva versión.

    Si ``schema_json`` no se envía, se usa el ``schema_json`` vigente del schema
    padre. Además, se actualiza el campo ``version`` del schema a la etiqueta
    recibida (bump semántico). Devuelve 404 si el schema no existe o es de otro
    tenant.
    """
    schema = schema_repository.get(tenant_id=tenant_id, schema_id=schema_id)
    if schema is None:
        raise NotFoundError(
            message="JSON Schema no encontrado para el tenant activo",
            operation="schemas.version.create",
        )
    snapshot_json = payload.schema_json or schema.schema_json
    version = versions_repository.create_version(
        tenant_id=tenant_id,
        schema_id=schema_id,
        version=payload.version,
        schema_json=snapshot_json,
        change_note=payload.change_note,
    )
    schema.version = payload.version
    audit.record(
        tenant_id=tenant_id,
        operation="schemas.version.create",
        entity_type="developer_schema",
        entity_id=str(schema_id),
        details={
            "version": payload.version,
            "change_note": payload.change_note,
        },
    )
    return SchemaVersionRead(
        id=version.id,
        tenant_id=version.tenant_id,
        schema_id=version.schema_id,
        version=version.version,
        schema_json=version.schema_json,
        change_note=version.change_note,
        created_at=version.created_at,
    )
