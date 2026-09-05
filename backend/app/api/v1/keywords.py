"""Endpoints de keywords con prioridades del bot (Fase 3).

Cada keyword asocia un ``term`` canónico (único por tenant) con una ``response``
fija, un ``priority`` (menor número = mayor prioridad) y un estado ``enabled``.
El motor de conversación resuelve estas keywords en orden de prioridad antes de
delegar en la IA (matching determinista).
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, Response, status

from app.api.deps import (
    get_current_tenant,
    get_keyword_repository,
    require_role,
)
from app.core.errors import InputValidationError, NotFoundError
from app.models.user import Role
from app.repositories.interfaces import IKeywordRepository
from app.schemas.common import Page, Pagination
from app.schemas.keywords import KeywordCreate, KeywordRead, KeywordUpdate

router = APIRouter(
    prefix="/bot/keywords",
    tags=["bot-keywords"],
    dependencies=[Depends(require_role(Role.ADMIN, Role.CONFIGURADOR))],
)


@router.get("", response_model=Page[KeywordRead])
def list_keywords(
    pagination: Pagination = Depends(),
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: IKeywordRepository = Depends(get_keyword_repository),
) -> Page[KeywordRead]:
    """Lista las keywords del tenant activo (paginado, orden por prioridad)."""
    items, total = repository.list(
        tenant_id=tenant_id, page=pagination.page, page_size=pagination.page_size
    )
    return Page(
        items=[KeywordRead.model_validate(item) for item in items],
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


@router.post("", response_model=KeywordRead, status_code=status.HTTP_201_CREATED)
def create_keyword(
    data: KeywordCreate,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: IKeywordRepository = Depends(get_keyword_repository),
) -> KeywordRead:
    """Crea una keyword canónica con respuesta fija (única por tenant)."""
    term = data.term.strip()
    if repository.get_by_term(tenant_id=tenant_id, term=term) is not None:
        raise InputValidationError(
            "Ya existe una keyword para ese término",
            operation="keywords.create",
            context={"tenant_id": str(tenant_id), "term": term},
        )
    row = repository.create(
        tenant_id=tenant_id,
        term=term,
        response=data.response,
        priority=data.priority,
        enabled=data.enabled,
    )
    return KeywordRead.model_validate(row)


@router.put("/{keyword_id}", response_model=KeywordRead)
def update_keyword(
    keyword_id: uuid.UUID,
    data: KeywordUpdate,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: IKeywordRepository = Depends(get_keyword_repository),
) -> KeywordRead:
    """Actualiza una keyword (solo los campos enviados)."""
    existing = repository.get(tenant_id=tenant_id, keyword_id=keyword_id)
    if existing is None:
        raise NotFoundError(
            "Keyword no encontrada para el tenant activo",
            operation="keywords.update",
            context={"tenant_id": str(tenant_id), "keyword_id": str(keyword_id)},
        )
    fields: dict[str, Any] = {}
    if data.term is not None:
        term = data.term.strip()
        conflict = repository.get_by_term(tenant_id=tenant_id, term=term)
        if conflict is not None and conflict.id != keyword_id:
            raise InputValidationError(
                "Ya existe una keyword para ese término",
                operation="keywords.update",
                context={"tenant_id": str(tenant_id), "term": term},
            )
        fields["term"] = term
    if data.response is not None:
        fields["response"] = data.response
    if data.priority is not None:
        fields["priority"] = data.priority
    if data.enabled is not None:
        fields["enabled"] = data.enabled
    row = repository.update(tenant_id=tenant_id, keyword_id=keyword_id, fields=fields)
    assert row is not None  # La existencia ya se verificó arriba.
    return KeywordRead.model_validate(row)


@router.delete("/{keyword_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_keyword(
    keyword_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: IKeywordRepository = Depends(get_keyword_repository),
) -> Response:
    """Soft-delete de una keyword (nunca borrado físico)."""
    deleted = repository.soft_delete(tenant_id=tenant_id, keyword_id=keyword_id)
    if not deleted:
        raise NotFoundError(
            "Keyword no encontrada para el tenant activo",
            operation="keywords.delete",
            context={"tenant_id": str(tenant_id), "keyword_id": str(keyword_id)},
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
