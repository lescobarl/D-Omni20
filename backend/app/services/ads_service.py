"""Servicio de campañas publicitarias (caso de uso CRUD + atribución UTM).

Contrato:
- Toda operación está acotada al ``tenant_id`` activo (defensa en profundidad
  sobre RLS) y se registra en el log de auditoría estructurado.
- El nombre de campaña es único por tenant → duplicados elevan
  :class:`ConflictError`.
- Errores de dominio se elevan como :class:`AppError` con contexto y
  ``operation`` (regla CLAUDE: error management with context).
- El servicio depende de interfaces (repositorio, auditoría, logger)
  inyectadas desde el composition root — nunca ``new`` (regla DI).
"""

from __future__ import annotations

import uuid

from app.core.errors import ConflictError, InputValidationError, NotFoundError
from app.core.logging import ILogger
from app.repositories.ads_interfaces import IAdsRepository
from app.schemas.ads import AdCampaignCreate, AdCampaignRead, AdCampaignUpdate
from app.schemas.common import Page
from app.services.interfaces import IAdsService, IAuditService


class AdsService(IAdsService):
    def __init__(
        self,
        *,
        repository: IAdsRepository,
        audit: IAuditService,
        logger: ILogger,
    ) -> None:
        self._repository = repository
        self._audit = audit
        self._logger = logger

    def create(self, *, tenant_id: uuid.UUID, data: AdCampaignCreate) -> AdCampaignRead:
        existing = self._repository.get_by_name(tenant_id=tenant_id, name=data.name)
        if existing is not None:
            raise ConflictError(
                "Ya existe una campaña con este nombre",
                operation="ads.create",
                context={"tenant_id": str(tenant_id), "name": data.name},
            )

        campaign = self._repository.create(
            tenant_id=tenant_id,
            name=data.name,
            status=data.status,
            enabled=data.enabled,
            utm_source=data.utm_source,
            utm_medium=data.utm_medium,
            utm_campaign=data.utm_campaign,
            utm_content=data.utm_content,
            utm_term=data.utm_term,
            landing_id=data.landing_id,
            budget_minor=data.budget_minor,
            start_at=data.start_at,
            end_at=data.end_at,
            notes=data.notes,
        )
        self._audit.record(
            tenant_id=tenant_id,
            operation="ads.create",
            entity_type="ad_campaign",
            entity_id=str(campaign.id),
            details={"name": data.name, "utm_campaign": data.utm_campaign},
        )
        self._logger.info(
            "ads.created",
            message="Campaña publicitaria creada",
            ad_campaign_id=str(campaign.id),
            tenant_id=str(tenant_id),
            name=data.name,
        )
        return AdCampaignRead.model_validate(campaign)

    def get(self, *, tenant_id: uuid.UUID, ad_campaign_id: uuid.UUID) -> AdCampaignRead:
        campaign = self._repository.get(
            tenant_id=tenant_id, ad_campaign_id=ad_campaign_id
        )
        if campaign is None:
            raise NotFoundError(
                "Campaña no encontrada",
                operation="ads.get",
                context={"tenant_id": str(tenant_id), "ad_campaign_id": str(ad_campaign_id)},
            )
        return AdCampaignRead.model_validate(campaign)

    def get_by_name(self, *, tenant_id: uuid.UUID, name: str) -> AdCampaignRead | None:
        campaign = self._repository.get_by_name(tenant_id=tenant_id, name=name)
        if campaign is None:
            return None
        return AdCampaignRead.model_validate(campaign)

    def list(
        self, *, tenant_id: uuid.UUID, page: int, page_size: int
    ) -> Page[AdCampaignRead]:
        items, total = self._repository.list(
            tenant_id=tenant_id, page=page, page_size=page_size
        )
        return Page(
            items=[AdCampaignRead.model_validate(item) for item in items],
            total=total,
            page=page,
            page_size=page_size,
        )

    def update(
        self,
        *,
        tenant_id: uuid.UUID,
        ad_campaign_id: uuid.UUID,
        data: AdCampaignUpdate,
    ) -> AdCampaignRead:
        fields = data.model_dump(exclude_unset=True)
        if not fields:
            raise InputValidationError(
                "No se recibieron campos para actualizar",
                operation="ads.update",
                context={"tenant_id": str(tenant_id), "ad_campaign_id": str(ad_campaign_id)},
            )

        if "name" in fields:
            existing = self._repository.get_by_name(tenant_id=tenant_id, name=fields["name"])
            if existing is not None and existing.id != ad_campaign_id:
                raise ConflictError(
                    "Ya existe una campaña con este nombre",
                    operation="ads.update",
                    context={
                        "tenant_id": str(tenant_id),
                        "ad_campaign_id": str(ad_campaign_id),
                        "name": fields["name"],
                    },
                )

        campaign = self._repository.update(
            tenant_id=tenant_id, ad_campaign_id=ad_campaign_id, fields=fields
        )
        if campaign is None:
            raise NotFoundError(
                "Campaña no encontrada",
                operation="ads.update",
                context={"tenant_id": str(tenant_id), "ad_campaign_id": str(ad_campaign_id)},
            )
        self._audit.record(
            tenant_id=tenant_id,
            operation="ads.update",
            entity_type="ad_campaign",
            entity_id=str(campaign.id),
            details={"fields": list(fields.keys())},
        )
        self._logger.info(
            "ads.updated",
            message="Campaña publicitaria actualizada",
            ad_campaign_id=str(campaign.id),
            tenant_id=str(tenant_id),
            fields=",".join(sorted(fields.keys())),
        )
        return AdCampaignRead.model_validate(campaign)

    def delete(self, *, tenant_id: uuid.UUID, ad_campaign_id: uuid.UUID) -> None:
        deleted = self._repository.soft_delete(
            tenant_id=tenant_id, ad_campaign_id=ad_campaign_id
        )
        if not deleted:
            raise NotFoundError(
                "Campaña no encontrada",
                operation="ads.delete",
                context={"tenant_id": str(tenant_id), "ad_campaign_id": str(ad_campaign_id)},
            )
        self._audit.record(
            tenant_id=tenant_id,
            operation="ads.delete",
            entity_type="ad_campaign",
            entity_id=str(ad_campaign_id),
            details={"deleted": True},
        )
        self._logger.info(
            "ads.deleted",
            message="Campaña publicitaria eliminada (soft delete)",
            ad_campaign_id=str(ad_campaign_id),
            tenant_id=str(tenant_id),
        )
