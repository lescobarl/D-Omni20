"""Implementaciones SQLAlchemy de los repositorios (inyectadas vía DI).

Reglas aplicadas:
- Toda query de landing se acota por ``tenant_id`` y ``deleted=False``
  (defensa en profundidad junto con RLS de PostgreSQL).
- Soft-delete (nunca DELETE físico) — regla CLAUDE tupla sync.
- Sin ``try/except`` vacío: los errores se propagan al servicio con contexto.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.audit_log import AuditLog
from app.models.landing import TenantLanding
from app.models.tenant import Tenant
from app.repositories.interfaces import IAuditRepository, ILandingRepository, ITenantRepository


class SqlAlchemyTenantRepository(ITenantRepository):
    def __init__(self, session: Session) -> None:
        self._session = session

    def get_by_id(self, tenant_id: uuid.UUID) -> Tenant | None:
        return self._session.get(Tenant, tenant_id)

    def get_by_slug(self, slug: str) -> Tenant | None:
        statement = select(Tenant).where(Tenant.slug == slug, Tenant.deleted.is_(False))
        return self._session.scalars(statement).first()

    def create(self, slug: str, name: str) -> Tenant:
        tenant = Tenant(slug=slug, name=name)
        self._session.add(tenant)
        self._session.flush()
        return tenant

    def list_all(self) -> list[Tenant]:
        statement = select(Tenant).where(Tenant.deleted.is_(False)).order_by(Tenant.slug)
        return list(self._session.scalars(statement).all())


class SqlAlchemyLandingRepository(ILandingRepository):
    def __init__(self, session: Session) -> None:
        self._session = session

    @staticmethod
    def _active_scope(tenant_id: uuid.UUID) -> Any:
        """Filtro común: tenant activo + sin soft-delete."""
        return (TenantLanding.tenant_id == tenant_id) & (TenantLanding.deleted.is_(False))

    def create(
        self,
        *,
        tenant_id: uuid.UUID,
        campaign_id: uuid.UUID,
        name: str,
        config: dict[str, Any],
    ) -> TenantLanding:
        landing = TenantLanding(
            tenant_id=tenant_id,
            campaign_id=campaign_id,
            name=name,
            config=config,
        )
        self._session.add(landing)
        self._session.flush()
        return landing

    def get(self, *, tenant_id: uuid.UUID, landing_id: uuid.UUID) -> TenantLanding | None:
        statement = (
            select(TenantLanding)
            .where(TenantLanding.id == landing_id, self._active_scope(tenant_id))
        )
        return self._session.scalars(statement).first()

    def get_by_campaign(self, *, tenant_id: uuid.UUID, campaign_id: uuid.UUID) -> TenantLanding | None:
        statement = (
            select(TenantLanding)
            .where(TenantLanding.campaign_id == campaign_id, self._active_scope(tenant_id))
        )
        return self._session.scalars(statement).first()

    def list(self, *, tenant_id: uuid.UUID, page: int, page_size: int) -> tuple[list[TenantLanding], int]:
        base = select(TenantLanding).where(self._active_scope(tenant_id))
        total = self._session.scalar(select(func.count()).select_from(base.subquery())) or 0
        statement = base.order_by(TenantLanding.updated_at.desc()).offset((page - 1) * page_size).limit(page_size)
        items = list(self._session.scalars(statement).all())
        return items, total

    def update(
        self,
        *,
        tenant_id: uuid.UUID,
        landing_id: uuid.UUID,
        fields: dict[str, Any],
    ) -> TenantLanding | None:
        landing = self.get(tenant_id=tenant_id, landing_id=landing_id)
        if landing is None:
            return None
        for key, value in fields.items():
            if hasattr(landing, key):
                setattr(landing, key, value)
        self._session.flush()
        return landing

    def soft_delete(self, *, tenant_id: uuid.UUID, landing_id: uuid.UUID) -> bool:
        landing = self.get(tenant_id=tenant_id, landing_id=landing_id)
        if landing is None:
            return False
        landing.deleted = True
        self._session.flush()
        return True

    def publish(self, *, tenant_id: uuid.UUID, landing_id: uuid.UUID, published: bool) -> TenantLanding | None:
        landing = self.get(tenant_id=tenant_id, landing_id=landing_id)
        if landing is None:
            return None
        landing.published = published
        if published:
            from app.models.base import utcnow

            landing.published_at = utcnow()
        else:
            landing.published_at = None
        self._session.flush()
        return landing


class SqlAlchemyAuditRepository(IAuditRepository):
    def __init__(self, session: Session) -> None:
        self._session = session

    def record(
        self,
        *,
        tenant_id: uuid.UUID | None,
        user_id: str | None,
        request_id: str,
        operation: str,
        entity_type: str | None = None,
        entity_id: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> AuditLog:
        entry = AuditLog(
            tenant_id=tenant_id,
            user_id=user_id,
            request_id=request_id,
            operation=operation,
            entity_type=entity_type,
            entity_id=str(entity_id) if entity_id is not None else None,
            details=dict(details or {}),
        )
        self._session.add(entry)
        self._session.flush()
        return entry

    def list(
        self,
        *,
        tenant_id: uuid.UUID,
        page: int,
        page_size: int,
        operation: str | None = None,
    ) -> tuple[list[AuditLog], int]:
        statement = select(AuditLog).where(AuditLog.tenant_id == tenant_id)
        if operation:
            statement = statement.where(AuditLog.operation == operation)
        total = self._session.scalar(select(func.count()).select_from(statement.subquery())) or 0
        ordered = statement.order_by(AuditLog.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
        items = list(self._session.scalars(ordered).all())
        return items, total
