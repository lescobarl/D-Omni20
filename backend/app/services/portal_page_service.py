"""Servicio de páginas del Portal del Cliente (caso de uso CRUD + publicar).

Contrato:
- Toda operación está acotada al ``tenant_id`` activo (defensa en profundidad
  sobre RLS) y se registra en el log de auditoría estructurado.
- Errores de dominio se elevan como :class:`AppError` con contexto y
  ``operation`` (regla CLAUDE: error management with context).
- El servicio depende de interfaces (repositorio, auditoría, logger)
  inyectadas desde el composition root — nunca ``new`` (regla DI).
"""

from __future__ import annotations

import uuid

from app.core.errors import ConflictError, InputValidationError, NotFoundError
from app.core.logging import ILogger
from app.repositories.interfaces import IPortalPageRepository
from app.schemas.common import Page
from app.schemas.portal_page import PortalPageCreate, PortalPageRead, PortalPageUpdate
from app.services.interfaces import IAuditService, IPortalPageService


class PortalPageService(IPortalPageService):
    def __init__(
        self,
        *,
        repository: IPortalPageRepository,
        audit: IAuditService,
        logger: ILogger,
    ) -> None:
        self._repository = repository
        self._audit = audit
        self._logger = logger

    def create(self, *, tenant_id: uuid.UUID, data: PortalPageCreate) -> PortalPageRead:
        existing = self._repository.get_by_slug(tenant_id=tenant_id, slug=data.slug)
        if existing is not None:
            raise ConflictError(
                "Ya existe una página del portal con este slug",
                operation="portal_page.create",
                context={"tenant_id": str(tenant_id), "slug": data.slug},
            )

        page = self._repository.create(
            tenant_id=tenant_id,
            slug=data.slug,
            title=data.title,
            blocks=data.blocks,
        )
        self._audit.record(
            tenant_id=tenant_id,
            operation="portal_page.create",
            entity_type="portal_page",
            entity_id=str(page.id),
            details={"slug": data.slug, "title": data.title},
        )
        self._logger.info(
            "portal_page.created",
            message="Página del portal creada",
            page_id=str(page.id),
            tenant_id=str(tenant_id),
            slug=data.slug,
        )
        return PortalPageRead.model_validate(page)

    def get(self, *, tenant_id: uuid.UUID, page_id: uuid.UUID) -> PortalPageRead:
        page = self._repository.get(tenant_id=tenant_id, page_id=page_id)
        if page is None:
            raise NotFoundError(
                "Página del portal no encontrada",
                operation="portal_page.get",
                context={"tenant_id": str(tenant_id), "page_id": str(page_id)},
            )
        return PortalPageRead.model_validate(page)

    def list(self, *, tenant_id: uuid.UUID, page: int, page_size: int) -> Page[PortalPageRead]:
        items, total = self._repository.list(
            tenant_id=tenant_id, page=page, page_size=page_size
        )
        return Page(
            items=[PortalPageRead.model_validate(item) for item in items],
            total=total,
            page=page,
            page_size=page_size,
        )

    def update(
        self, *, tenant_id: uuid.UUID, page_id: uuid.UUID, data: PortalPageUpdate
    ) -> PortalPageRead:
        fields = data.model_dump(exclude_unset=True)
        if not fields:
            raise InputValidationError(
                "No se recibieron campos para actualizar",
                operation="portal_page.update",
                context={"tenant_id": str(tenant_id), "page_id": str(page_id)},
            )

        # Si se cambia el slug, validar unicidad dentro del tenant.
        if "slug" in fields:
            existing = self._repository.get_by_slug(
                tenant_id=tenant_id, slug=fields["slug"]
            )
            if existing is not None and existing.id != page_id:
                raise ConflictError(
                    "Ya existe una página del portal con este slug",
                    operation="portal_page.update",
                    context={"tenant_id": str(tenant_id), "slug": fields["slug"]},
                )

        page = self._repository.update(
            tenant_id=tenant_id, page_id=page_id, fields=fields
        )
        if page is None:
            raise NotFoundError(
                "Página del portal no encontrada",
                operation="portal_page.update",
                context={"tenant_id": str(tenant_id), "page_id": str(page_id)},
            )
        self._audit.record(
            tenant_id=tenant_id,
            operation="portal_page.update",
            entity_type="portal_page",
            entity_id=str(page.id),
            details={"fields": list(fields.keys())},
        )
        self._logger.info(
            "portal_page.updated",
            message="Página del portal actualizada",
            page_id=str(page.id),
            tenant_id=str(tenant_id),
            fields=",".join(sorted(fields.keys())),
        )
        return PortalPageRead.model_validate(page)

    def delete(self, *, tenant_id: uuid.UUID, page_id: uuid.UUID) -> None:
        deleted = self._repository.soft_delete(tenant_id=tenant_id, page_id=page_id)
        if not deleted:
            raise NotFoundError(
                "Página del portal no encontrada",
                operation="portal_page.delete",
                context={"tenant_id": str(tenant_id), "page_id": str(page_id)},
            )
        self._audit.record(
            tenant_id=tenant_id,
            operation="portal_page.delete",
            entity_type="portal_page",
            entity_id=str(page_id),
            details={"deleted": True},
        )
        self._logger.info(
            "portal_page.deleted",
            message="Página del portal eliminada (soft delete)",
            page_id=str(page_id),
            tenant_id=str(tenant_id),
        )

    def publish(
        self, *, tenant_id: uuid.UUID, page_id: uuid.UUID, published: bool
    ) -> PortalPageRead:
        page = self._repository.publish(
            tenant_id=tenant_id, page_id=page_id, published=published
        )
        if page is None:
            raise NotFoundError(
                "Página del portal no encontrada",
                operation="portal_page.publish",
                context={"tenant_id": str(tenant_id), "page_id": str(page_id)},
            )
        self._audit.record(
            tenant_id=tenant_id,
            operation="portal_page.publish",
            entity_type="portal_page",
            entity_id=str(page.id),
            details={"published": published},
        )
        self._logger.info(
            "portal_page.published" if published else "portal_page.unpublished",
            message="Página del portal publicada" if published else "Página del portal despublicada",
            page_id=str(page.id),
            tenant_id=str(tenant_id),
            published=str(published),
        )
        return PortalPageRead.model_validate(page)
