"""Endpoints de canales del bot (WhatsApp Cloud API) con secretos cifrados.

CRUD acotado al tenant activo (``X-Tenant-Id`` vía ``get_current_tenant``) y
delegado en :class:`ITenantChannelRepository` (puerto por ``Depends``). Los
secretos (``access_token`` / ``webhook_secret``) son *write-only*: se aceptan
en create/update pero NUNCA se devuelven en las respuestas (regla CLAUDE:
secrets).
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response, status

from app.api.deps import (
    get_current_tenant,
    get_tenant_channel_repository,
    require_role,
)
from app.core.errors import ConflictError, InputValidationError, NotFoundError
from app.models.user import Role
from app.repositories.interfaces import ITenantChannelRepository
from app.schemas.common import Page, Pagination
from app.schemas.tenant_config import (
    TenantChannelCreate,
    TenantChannelRead,
    TenantChannelUpdate,
)

router = APIRouter(
    prefix="/channels",
    tags=["channels"],
    dependencies=[Depends(require_role(Role.ADMIN))],
)


@router.get("", response_model=Page[TenantChannelRead])
def list_channels(
    pagination: Pagination = Depends(),
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: ITenantChannelRepository = Depends(get_tenant_channel_repository),
) -> Page[TenantChannelRead]:
    """Lista los canales del bot del tenant activo (paginado)."""
    items, total = repository.list(
        tenant_id=tenant_id, page=pagination.page, page_size=pagination.page_size
    )
    return Page(
        items=[TenantChannelRead.model_validate(item) for item in items],
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


@router.post("", response_model=TenantChannelRead, status_code=status.HTTP_201_CREATED)
def create_channel(
    data: TenantChannelCreate,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: ITenantChannelRepository = Depends(get_tenant_channel_repository),
) -> TenantChannelRead:
    """Crea un canal del bot; los secretos se cifran en reposo (write-only)."""
    if data.external_id:
        existing = repository.get_by_type(
            tenant_id=tenant_id, channel_type=data.channel_type
        )
        if any(
            row.external_id == data.external_id for row in existing
        ):
            raise ConflictError(
                "Ya existe un canal del mismo tipo con ese external_id",
                operation="channels.create",
                context={
                    "tenant_id": str(tenant_id),
                    "channel_type": data.channel_type,
                    "external_id": data.external_id,
                },
            )
    row = repository.create(
        tenant_id=tenant_id,
        channel_type=data.channel_type,
        external_id=data.external_id,
        phone_number=data.phone_number,
        phone_number_id=data.phone_number_id,
        access_token=data.access_token,
        webhook_secret=data.webhook_secret,
        enabled=data.enabled,
    )
    return TenantChannelRead.model_validate(row)


@router.get("/{channel_id}", response_model=TenantChannelRead)
def get_channel(
    channel_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: ITenantChannelRepository = Depends(get_tenant_channel_repository),
) -> TenantChannelRead:
    """Devuelve un canal del tenant activo (404 si no existe; sin secretos)."""
    row = repository.get(tenant_id=tenant_id, channel_id=channel_id)
    if row is None:
        raise NotFoundError(
            "Canal no encontrado para el tenant activo",
            operation="channels.get",
            context={"tenant_id": str(tenant_id), "channel_id": str(channel_id)},
        )
    return TenantChannelRead.model_validate(row)


@router.patch("/{channel_id}", response_model=TenantChannelRead)
def update_channel(
    channel_id: uuid.UUID,
    data: TenantChannelUpdate,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: ITenantChannelRepository = Depends(get_tenant_channel_repository),
) -> TenantChannelRead:
    """Actualiza parcialmente un canal (PATCH; secretos opcionales write-only)."""
    fields = data.model_dump(exclude_unset=True)
    if not fields:
        raise InputValidationError(
            "No se recibieron campos para actualizar",
            operation="channels.update",
            context={"tenant_id": str(tenant_id), "channel_id": str(channel_id)},
        )
    if "external_id" in fields and fields["external_id"]:
        existing = repository.get_by_type(
            tenant_id=tenant_id,
            channel_type=data.channel_type or _current_channel_type(
                repository, tenant_id, channel_id
            ),
        )
        if any(
            row.external_id == fields["external_id"] and row.id != channel_id
            for row in existing
        ):
            raise ConflictError(
                "Ya existe un canal del mismo tipo con ese external_id",
                operation="channels.update",
                context={
                    "tenant_id": str(tenant_id),
                    "channel_id": str(channel_id),
                    "external_id": fields["external_id"],
                },
            )
    row = repository.update(tenant_id=tenant_id, channel_id=channel_id, fields=fields)
    if row is None:
        raise NotFoundError(
            "Canal no encontrado para el tenant activo",
            operation="channels.update",
            context={"tenant_id": str(tenant_id), "channel_id": str(channel_id)},
        )
    return TenantChannelRead.model_validate(row)


@router.delete("/{channel_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_channel(
    channel_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(get_current_tenant),
    repository: ITenantChannelRepository = Depends(get_tenant_channel_repository),
) -> Response:
    """Soft-delete de un canal (nunca borrado físico)."""
    deleted = repository.soft_delete(tenant_id=tenant_id, channel_id=channel_id)
    if not deleted:
        raise NotFoundError(
            "Canal no encontrado para el tenant activo",
            operation="channels.delete",
            context={"tenant_id": str(tenant_id), "channel_id": str(channel_id)},
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _current_channel_type(
    repository: ITenantChannelRepository,
    tenant_id: uuid.UUID,
    channel_id: uuid.UUID,
) -> str:
    """Resuelve el ``channel_type`` vigente del canal para el chequeo de conflicto."""
    row = repository.get(tenant_id=tenant_id, channel_id=channel_id)
    return row.channel_type if row is not None else "whatsapp"
