"""Endpoints del catálogo de productos/servicios del tenant (precios y stock).

CRUD acotado al tenant activo (``X-Tenant-Id`` vía ``get_current_tenant``) y
delegado en :class:`ICatalogItemRepository` (puerto por ``Depends``). El
``sku`` es único por tenant; borrado con *soft-delete*.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response, status

from app.api.deps import (
    get_catalog_item_repository,
    get_current_tenant,
    require_role,
)
from app.core.errors import ConflictError, InputValidationError, NotFoundError
from app.models.user import Role
from app.repositories.interfaces import ICatalogItemRepository
from app.schemas.common import Page, Pagination
from app.schemas.tenant_config import CatalogItemCreate, CatalogItemRead, CatalogItemUpdate

router = APIRouter(
    prefix="/catalog",
    tags=["catalog"],
    dependencies=[Depends(require_role(Role.ADMIN, Role.CONFIGURADOR))],
)


@router.get("", response_model=Page[CatalogItemRead])
def list_catalog_items(
    pagination: Pagination = Depends(),
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: ICatalogItemRepository = Depends(get_catalog_item_repository),
) -> Page[CatalogItemRead]:
    """Lista el catálogo del tenant activo (paginado)."""
    items, total = repository.list(
        tenant_id=tenant_id, page=pagination.page, page_size=pagination.page_size
    )
    return Page(
        items=[CatalogItemRead.model_validate(item) for item in items],
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


@router.post("", response_model=CatalogItemRead, status_code=status.HTTP_201_CREATED)
def create_catalog_item(
    data: CatalogItemCreate,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: ICatalogItemRepository = Depends(get_catalog_item_repository),
) -> CatalogItemRead:
    """Crea un producto/servicio del catálogo (SKU único por tenant)."""
    existing = repository.get_by_sku(tenant_id=tenant_id, sku=data.sku)
    if existing is not None:
        raise ConflictError(
            "Ya existe un ítem del catálogo con ese SKU",
            operation="catalog.create",
            context={"tenant_id": str(tenant_id), "sku": data.sku},
        )
    row = repository.create(
        tenant_id=tenant_id,
        sku=data.sku,
        name=data.name,
        description=data.description,
        price=data.price,
        currency=data.currency,
        available=data.available,
        metadata=data.metadata,
    )
    return CatalogItemRead.model_validate(row)


@router.get("/{item_id}", response_model=CatalogItemRead)
def get_catalog_item(
    item_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: ICatalogItemRepository = Depends(get_catalog_item_repository),
) -> CatalogItemRead:
    """Devuelve un ítem del catálogo del tenant activo (404 si no existe)."""
    row = repository.get(tenant_id=tenant_id, item_id=item_id)
    if row is None:
        raise NotFoundError(
            "Ítem del catálogo no encontrado para el tenant activo",
            operation="catalog.get",
            context={"tenant_id": str(tenant_id), "item_id": str(item_id)},
        )
    return CatalogItemRead.model_validate(row)


@router.put("/{item_id}", response_model=CatalogItemRead)
def update_catalog_item(
    item_id: uuid.UUID,
    data: CatalogItemUpdate,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: ICatalogItemRepository = Depends(get_catalog_item_repository),
) -> CatalogItemRead:
    """Actualiza un ítem del catálogo (solo los campos enviados)."""
    fields = data.model_dump(exclude_unset=True)
    if not fields:
        raise InputValidationError(
            "No se recibieron campos para actualizar",
            operation="catalog.update",
            context={"tenant_id": str(tenant_id), "item_id": str(item_id)},
        )
    if "sku" in fields:
        existing = repository.get_by_sku(tenant_id=tenant_id, sku=fields["sku"])
        if existing is not None and existing.id != item_id:
            raise ConflictError(
                "Ya existe un ítem del catálogo con ese SKU",
                operation="catalog.update",
                context={"tenant_id": str(tenant_id), "sku": fields["sku"]},
            )
    row = repository.update(tenant_id=tenant_id, item_id=item_id, fields=fields)
    if row is None:
        raise NotFoundError(
            "Ítem del catálogo no encontrado para el tenant activo",
            operation="catalog.update",
            context={"tenant_id": str(tenant_id), "item_id": str(item_id)},
        )
    return CatalogItemRead.model_validate(row)


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_catalog_item(
    item_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: ICatalogItemRepository = Depends(get_catalog_item_repository),
) -> Response:
    """Soft-delete de un ítem del catálogo (nunca borrado físico)."""
    deleted = repository.soft_delete(tenant_id=tenant_id, item_id=item_id)
    if not deleted:
        raise NotFoundError(
            "Ítem del catálogo no encontrado para el tenant activo",
            operation="catalog.delete",
            context={"tenant_id": str(tenant_id), "item_id": str(item_id)},
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
