"""Servicio de landings (caso de uso CRUD + publicar + compilar).

Contrato:
- Toda operación está acotada al ``tenant_id`` activo (defensa en profundidad
  sobre RLS) y se registra en el log de auditoría estructurado.
- Errores de dominio se elevan como :class:`AppError` con contexto y
  ``operation`` (regla CLAUDE: error management with context).
- El servicio depende de interfaces (repositorio, auditoría, compilador,
  logger) inyectadas desde el composition root — nunca ``new`` (regla DI).
"""

from __future__ import annotations

import re
import time
import uuid

from app.core.errors import ConflictError, InputValidationError, NotFoundError
from app.core.logging import ILogger
from app.models.base import utcnow
from app.repositories.interfaces import ILandingRepository
from app.schemas.common import Page
from app.schemas.landing import (
    LandingCompileRequest,
    LandingCompileResponse,
    LandingCreate,
    LandingRead,
    LandingUpdate,
)
from app.services.compiler_service import minify_html
from app.services.interfaces import (
    IAuditService,
    ICdnDeploymentService,
    ICompilerService,
    ILandingService,
)


def _slugify(value: str) -> str:
    """Normaliza un texto a slug URL amigable (minúsculas, guiones).

    Ej.: ``"Casa con vista al lago Tequesquitengo"`` →
    ``"casa-con-vista-al-lago-tequesquitengo"``. Si el resultado queda vacío,
    devuelve ``"landing"`` como valor por defecto.
    """
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "landing"


class LandingService(ILandingService):
    def __init__(
        self,
        *,
        repository: ILandingRepository,
        audit: IAuditService,
        compiler: ICompilerService,
        cdn: ICdnDeploymentService,
        logger: ILogger,
    ) -> None:
        self._repository = repository
        self._audit = audit
        self._compiler = compiler
        self._cdn = cdn
        self._logger = logger

    def create(self, *, tenant_id: uuid.UUID, data: LandingCreate) -> LandingRead:
        existing = self._repository.get_by_campaign(
            tenant_id=tenant_id, campaign_id=data.campaign_id
        )
        if existing is not None:
            raise ConflictError(
                "Ya existe una landing para esta campaña",
                operation="landing.create",
                context={"tenant_id": str(tenant_id), "campaign_id": str(data.campaign_id)},
            )

        slug = data.slug or _slugify(data.name)
        existing_slug = self._repository.get_by_slug(tenant_id=tenant_id, slug=slug)
        if existing_slug is not None:
            raise ConflictError(
                "Ya existe una landing con esta URL amigable",
                operation="landing.create",
                context={"tenant_id": str(tenant_id), "slug": slug},
            )

        landing = self._repository.create(
            tenant_id=tenant_id,
            campaign_id=data.campaign_id,
            slug=slug,
            name=data.name,
            config=data.config,
        )
        self._audit.record(
            tenant_id=tenant_id,
            operation="landing.create",
            entity_type="tenant_landing",
            entity_id=str(landing.id),
            details={"campaign_id": str(data.campaign_id), "name": data.name, "slug": slug},
        )
        self._logger.info(
            "landing.created",
            message="Landing creada",
            landing_id=str(landing.id),
            tenant_id=str(tenant_id),
            campaign_id=str(data.campaign_id),
            slug=slug,
        )
        return LandingRead.model_validate(landing)

    def get(self, *, tenant_id: uuid.UUID, landing_id: uuid.UUID) -> LandingRead:
        landing = self._repository.get(tenant_id=tenant_id, landing_id=landing_id)
        if landing is None:
            raise NotFoundError(
                "Landing no encontrada",
                operation="landing.get",
                context={"tenant_id": str(tenant_id), "landing_id": str(landing_id)},
            )
        return LandingRead.model_validate(landing)

    def list(self, *, tenant_id: uuid.UUID, page: int, page_size: int) -> Page[LandingRead]:
        items, total = self._repository.list(
            tenant_id=tenant_id, page=page, page_size=page_size
        )
        return Page(
            items=[LandingRead.model_validate(item) for item in items],
            total=total,
            page=page,
            page_size=page_size,
        )

    def update(
        self, *, tenant_id: uuid.UUID, landing_id: uuid.UUID, data: LandingUpdate
    ) -> LandingRead:
        fields = data.model_dump(exclude_unset=True)
        if not fields:
            raise InputValidationError(
                "No se recibieron campos para actualizar",
                operation="landing.update",
                context={"tenant_id": str(tenant_id), "landing_id": str(landing_id)},
            )

        landing = self._repository.update(
            tenant_id=tenant_id, landing_id=landing_id, fields=fields
        )
        if landing is None:
            raise NotFoundError(
                "Landing no encontrada",
                operation="landing.update",
                context={"tenant_id": str(tenant_id), "landing_id": str(landing_id)},
            )
        self._audit.record(
            tenant_id=tenant_id,
            operation="landing.update",
            entity_type="tenant_landing",
            entity_id=str(landing.id),
            details={"fields": list(fields.keys())},
        )
        self._logger.info(
            "landing.updated",
            message="Landing actualizada",
            landing_id=str(landing.id),
            tenant_id=str(tenant_id),
            fields=",".join(sorted(fields.keys())),
        )
        return LandingRead.model_validate(landing)

    def delete(self, *, tenant_id: uuid.UUID, landing_id: uuid.UUID) -> None:
        deleted = self._repository.soft_delete(tenant_id=tenant_id, landing_id=landing_id)
        if not deleted:
            raise NotFoundError(
                "Landing no encontrada",
                operation="landing.delete",
                context={"tenant_id": str(tenant_id), "landing_id": str(landing_id)},
            )
        self._audit.record(
            tenant_id=tenant_id,
            operation="landing.delete",
            entity_type="tenant_landing",
            entity_id=str(landing_id),
            details={"deleted": True},
        )
        self._logger.info(
            "landing.deleted",
            message="Landing eliminada (soft delete)",
            landing_id=str(landing_id),
            tenant_id=str(tenant_id),
        )

    def publish(
        self, *, tenant_id: uuid.UUID, landing_id: uuid.UUID, published: bool
    ) -> LandingRead:
        landing = self._repository.publish(
            tenant_id=tenant_id, landing_id=landing_id, published=published
        )
        if landing is None:
            raise NotFoundError(
                "Landing no encontrada",
                operation="landing.publish",
                context={"tenant_id": str(tenant_id), "landing_id": str(landing_id)},
            )
        self._audit.record(
            tenant_id=tenant_id,
            operation="landing.publish",
            entity_type="tenant_landing",
            entity_id=str(landing.id),
            details={"published": published},
        )
        self._logger.info(
            "landing.published" if published else "landing.unpublished",
            message="Landing publicada" if published else "Landing despublicada",
            landing_id=str(landing.id),
            tenant_id=str(tenant_id),
            published=str(published),
        )
        # Despliegue automático al CDN: publicar genera la versión + URL + HTML
        # compilado de forma determinista para CUALQUIER cliente, servida por
        # ``GET /cdn/{landing_id}/v{version}`` en un navegador independiente.
        if published:
            self._cdn.deploy(tenant_id=tenant_id, landing_id=landing_id)
        return LandingRead.model_validate(landing)

    def compile(
        self,
        *,
        tenant_id: uuid.UUID,
        data: LandingCompileRequest,
    ) -> LandingCompileResponse:
        started = time.perf_counter()
        html = self._compiler.compile(
            config=data.config, template_name=data.template_name
        )
        if data.minify:
            html = minify_html(html)
        duration_ms = round((time.perf_counter() - started) * 1000, 3)
        self._audit.record(
            tenant_id=tenant_id,
            operation="landing.compile",
            entity_type="tenant_landing",
            entity_id=None,
            details={
                "template_name": data.template_name,
                "duration_ms": duration_ms,
                "minify": data.minify,
            },
        )
        self._logger.info(
            "landing.compiled",
            message="Configuración compilada a HTML",
            tenant_id=str(tenant_id),
            template_name=data.template_name,
            duration_ms=str(duration_ms),
            minify=str(data.minify),
        )
        return LandingCompileResponse(
            html=html, compiled_at=utcnow(), duration_ms=duration_ms
        )
