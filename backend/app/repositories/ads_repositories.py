"""Implementación SQLAlchemy del repositorio de campañas publicitarias (inyectada vía DI).

Reglas aplicadas:
- Toda query se acota por ``tenant_id`` y ``deleted=False`` (defensa en
  profundidad junto con RLS de PostgreSQL).
- ``resolve_by_utm`` resuelve la campaña activa por la firma UTM del lead:
  primario ``utm_campaign`` y, en segundo plano, ``utm_source``/``utm_medium``.
- Sin ``try/except`` vacío: los errores se propagan al servicio con contexto.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.ads import AdCampaign
from app.repositories.ads_interfaces import IAdsRepository


class SqlAlchemyAdsRepository(IAdsRepository):
    def __init__(self, session: Session) -> None:
        self._session = session

    # ── Helpers ──────────────────────────────────────────────────────────────
    @staticmethod
    def _active_scope(tenant_id: uuid.UUID) -> Any:
        """Filtro común: tenant activo + sin soft-delete."""
        return (AdCampaign.tenant_id == tenant_id) & (AdCampaign.deleted.is_(False))

    @staticmethod
    def _apply_fields(entity: AdCampaign, fields: dict[str, Any]) -> None:
        """Aplica solo los campos existentes en la entidad (fail-fast al resto)."""
        for key, value in fields.items():
            if not hasattr(entity, key):
                raise ValueError(f"Campo desconocido para la entidad: {key}")
            setattr(entity, key, value)

    # ── CRUD ─────────────────────────────────────────────────────────────────
    def create(
        self,
        *,
        tenant_id: uuid.UUID,
        name: str,
        status: str,
        enabled: bool,
        utm_source: str | None,
        utm_medium: str | None,
        utm_campaign: str | None,
        utm_content: str | None,
        utm_term: str | None,
        landing_id: uuid.UUID | None,
        budget_minor: int | None,
        start_at: datetime | None,
        end_at: datetime | None,
        notes: str | None,
    ) -> AdCampaign:
        campaign = AdCampaign(
            tenant_id=tenant_id,
            name=name,
            status=status,
            enabled=enabled,
            utm_source=utm_source,
            utm_medium=utm_medium,
            utm_campaign=utm_campaign,
            utm_content=utm_content,
            utm_term=utm_term,
            landing_id=landing_id,
            budget_minor=budget_minor,
            start_at=start_at,
            end_at=end_at,
            notes=notes,
        )
        self._session.add(campaign)
        self._session.flush()
        return campaign

    def get(self, *, tenant_id: uuid.UUID, ad_campaign_id: uuid.UUID) -> AdCampaign | None:
        statement = select(AdCampaign).where(
            AdCampaign.id == ad_campaign_id,
            self._active_scope(tenant_id),
        )
        return self._session.scalars(statement).first()

    def get_by_name(self, *, tenant_id: uuid.UUID, name: str) -> AdCampaign | None:
        statement = select(AdCampaign).where(
            AdCampaign.name == name,
            self._active_scope(tenant_id),
        )
        return self._session.scalars(statement).first()

    def resolve_by_utm(
        self,
        *,
        tenant_id: uuid.UUID,
        utm_campaign: str | None,
        utm_source: str | None,
        utm_medium: str | None,
    ) -> AdCampaign | None:
        """Localiza la campaña activa del tenant por firma UTM (atribución).

        Prioridad: 1) ``utm_campaign`` exacto; 2) ``utm_source``+``utm_medium``.
        Solo considera campañas habilitadas y no eliminadas.
        """
        scope = self._active_scope(tenant_id) & AdCampaign.enabled.is_(True)

        if utm_campaign:
            statement = select(AdCampaign).where(
                scope,
                AdCampaign.utm_campaign == utm_campaign,
            )
            campaign = self._session.scalars(statement).first()
            if campaign is not None:
                return campaign

        if utm_source or utm_medium:
            filters: list[Any] = []
            if utm_source:
                filters.append(AdCampaign.utm_source == utm_source)
            if utm_medium:
                filters.append(AdCampaign.utm_medium == utm_medium)
            statement = select(AdCampaign).where(scope, *filters)
            return self._session.scalars(statement).first()

        return None

    def list(
        self, *, tenant_id: uuid.UUID, page: int, page_size: int
    ) -> tuple[list[AdCampaign], int]:
        base = select(AdCampaign).where(self._active_scope(tenant_id))
        total = self._session.scalar(select(func.count()).select_from(base.subquery())) or 0
        statement = (
            base.order_by(AdCampaign.updated_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        items = list(self._session.scalars(statement).all())
        return items, total

    def update(
        self,
        *,
        tenant_id: uuid.UUID,
        ad_campaign_id: uuid.UUID,
        fields: dict[str, Any],
    ) -> AdCampaign | None:
        campaign = self.get(tenant_id=tenant_id, ad_campaign_id=ad_campaign_id)
        if campaign is None:
            return None
        self._apply_fields(campaign, fields)
        self._session.flush()
        return campaign

    def soft_delete(self, *, tenant_id: uuid.UUID, ad_campaign_id: uuid.UUID) -> bool:
        campaign = self.get(tenant_id=tenant_id, ad_campaign_id=ad_campaign_id)
        if campaign is None:
            return False
        campaign.deleted = True
        self._session.flush()
        return True
