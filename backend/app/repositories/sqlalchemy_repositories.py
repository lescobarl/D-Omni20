"""Implementaciones SQLAlchemy de los repositorios (inyectadas vía DI).

Reglas aplicadas:
- Toda query de landing se acota por ``tenant_id`` y ``deleted=False``
  (defensa en profundidad junto con RLS de PostgreSQL).
- Soft-delete (nunca DELETE físico) — regla CLAUDE tupla sync.
- Sin ``try/except`` vacío: los errores se propagan al servicio con contexto.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.database import Database
from app.core.encryption import TokenCipher
from app.models.analytics_event import AnalyticsEvent
from app.models.audit_log import AuditLog
from app.models.cdn_deployment import CdnDeployment
from app.models.landing import TenantLanding
from app.models.marketplace_template import MarketplaceTemplate
from app.models.pseo_batch import PseoBatch
from app.models.pseo_host import PseoHost
from app.models.pseo_page import PseoPage
from app.models.schema import DeveloperSchema
from app.models.schema_version import SchemaVersion
from app.models.tenant import Tenant, TenantOAuthToken
from app.repositories.interfaces import (
    AnalyticsSnapshot,
    IAnalyticsRepository,
    ICdnDeploymentRepository,
    IAuditRepository,
    ILandingRepository,
    IMarketplaceRepository,
    IOAuthTokenStore,
    IPseoBatchRepository,
    IPseoHostRepository,
    IPseoPageRepository,
    ISchemaRepository,
    ISchemaVersionRepository,
    ITenantRepository,
    StoredOAuthToken,
)


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


class SqlAlchemySchemaRepository(ISchemaRepository):
    def __init__(self, session: Session) -> None:
        self._session = session

    @staticmethod
    def _active_scope(tenant_id: uuid.UUID) -> Any:
        """Filtro común: tenant activo + sin soft-delete."""
        return (DeveloperSchema.tenant_id == tenant_id) & (DeveloperSchema.deleted.is_(False))

    def save(
        self,
        *,
        tenant_id: uuid.UUID,
        name: str,
        schema_json: dict[str, Any],
        description: str | None = None,
        version: str = "1.0.0",
    ) -> DeveloperSchema:
        schema = DeveloperSchema(
            tenant_id=tenant_id,
            name=name,
            description=description,
            schema_json=schema_json,
            version=version,
        )
        self._session.add(schema)
        self._session.flush()
        return schema

    def get(self, *, tenant_id: uuid.UUID, schema_id: uuid.UUID) -> DeveloperSchema | None:
        statement = (
            select(DeveloperSchema)
            .where(DeveloperSchema.id == schema_id, self._active_scope(tenant_id))
        )
        return self._session.scalars(statement).first()

    def list(
        self, *, tenant_id: uuid.UUID, page: int, page_size: int
    ) -> tuple[list[DeveloperSchema], int]:
        base = select(DeveloperSchema).where(self._active_scope(tenant_id))
        total = self._session.scalar(select(func.count()).select_from(base.subquery())) or 0
        statement = (
            base.order_by(DeveloperSchema.updated_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        items = list(self._session.scalars(statement).all())
        return items, total

    def soft_delete(self, *, tenant_id: uuid.UUID, schema_id: uuid.UUID) -> bool:
        schema = self.get(tenant_id=tenant_id, schema_id=schema_id)
        if schema is None:
            return False
        schema.deleted = True
        self._session.flush()
        return True


class SqlAlchemySchemaVersionRepository(ISchemaVersionRepository):
    def __init__(self, session: Session) -> None:
        self._session = session

    @staticmethod
    def _active_scope(tenant_id: uuid.UUID, schema_id: uuid.UUID) -> Any:
        """Filtro común: tenant activo + schema padre (versiones append-only)."""
        return (SchemaVersion.tenant_id == tenant_id) & (
            SchemaVersion.schema_id == schema_id
        )

    def create_version(
        self,
        *,
        tenant_id: uuid.UUID,
        schema_id: uuid.UUID,
        version: str,
        schema_json: dict[str, Any],
        change_note: str | None = None,
    ) -> SchemaVersion:
        snapshot = SchemaVersion(
            tenant_id=tenant_id,
            schema_id=schema_id,
            version=version,
            schema_json=schema_json,
            change_note=change_note,
        )
        self._session.add(snapshot)
        self._session.flush()
        return snapshot

    def list_versions(
        self,
        *,
        tenant_id: uuid.UUID,
        schema_id: uuid.UUID,
        page: int,
        page_size: int,
    ) -> tuple[list[SchemaVersion], int]:
        base = select(SchemaVersion).where(
            self._active_scope(tenant_id, schema_id)
        )
        total = (
            self._session.scalar(select(func.count()).select_from(base.subquery()))
            or 0
        )
        statement = (
            base.order_by(SchemaVersion.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        items = list(self._session.scalars(statement).all())
        return items, total


class SqlAlchemyMarketplaceRepository(IMarketplaceRepository):
    def __init__(self, session: Session) -> None:
        self._session = session

    @staticmethod
    def _catalog_scope(tenant_id: uuid.UUID) -> Any:
        """Catálogo: templates públicos de cualquiera + los propios del tenant."""
        return or_(
            MarketplaceTemplate.is_public.is_(True),
            MarketplaceTemplate.tenant_id == tenant_id,
        )

    def create(
        self,
        *,
        tenant_id: uuid.UUID,
        name: str,
        description: str | None,
        category: str,
        config: dict[str, Any],
        thumbnail_url: str | None,
        is_public: bool,
    ) -> MarketplaceTemplate:
        template = MarketplaceTemplate(
            tenant_id=tenant_id,
            name=name,
            description=description,
            category=category,
            config=config,
            thumbnail_url=thumbnail_url,
            is_public=is_public,
            downloads=0,
        )
        self._session.add(template)
        self._session.flush()
        return template

    def get(
        self, *, tenant_id: uuid.UUID, template_id: uuid.UUID
    ) -> MarketplaceTemplate | None:
        statement = select(MarketplaceTemplate).where(
            MarketplaceTemplate.id == template_id,
            self._catalog_scope(tenant_id),
        )
        return self._session.scalars(statement).first()

    def list(
        self,
        *,
        tenant_id: uuid.UUID,
        page: int,
        page_size: int,
        category: str | None = None,
    ) -> tuple[list[MarketplaceTemplate], int]:
        scope = self._catalog_scope(tenant_id)
        if category:
            scope = scope & (MarketplaceTemplate.category == category)
        base = select(MarketplaceTemplate).where(scope)
        total = (
            self._session.scalar(select(func.count()).select_from(base.subquery()))
            or 0
        )
        statement = (
            base.order_by(MarketplaceTemplate.downloads.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        items = list(self._session.scalars(statement).all())
        return items, total

    def increment_downloads(
        self, *, tenant_id: uuid.UUID, template_id: uuid.UUID
    ) -> MarketplaceTemplate | None:
        template = self.get(tenant_id=tenant_id, template_id=template_id)
        if template is None:
            return None
        template.downloads += 1
        self._session.flush()
        return template


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


class SqlAlchemyAnalyticsRepository(IAnalyticsRepository):
    def __init__(self, session: Session) -> None:
        self._session = session

    def record(
        self,
        *,
        tenant_id: uuid.UUID,
        event_type: str,
        entity_type: str | None = None,
        entity_id: str | None = None,
        properties: dict[str, Any] | None = None,
        occurred_at: datetime | None = None,
    ) -> AnalyticsEvent:
        event = AnalyticsEvent(
            tenant_id=tenant_id,
            event_type=event_type,
            entity_type=entity_type,
            entity_id=str(entity_id) if entity_id is not None else None,
            properties=dict(properties or {}),
            occurred_at=occurred_at or datetime.now(timezone.utc),
        )
        self._session.add(event)
        self._session.flush()
        return event

    def aggregate(self, *, tenant_id: uuid.UUID) -> AnalyticsSnapshot:
        rows = self._session.execute(
            select(AnalyticsEvent.event_type, func.count())
            .where(AnalyticsEvent.tenant_id == tenant_id)
            .group_by(AnalyticsEvent.event_type)
        ).all()
        by_event_type = {event_type: count for event_type, count in rows}
        return AnalyticsSnapshot(
            total_events=sum(by_event_type.values()),
            by_event_type=by_event_type,
        )

    def recent(
        self, *, tenant_id: uuid.UUID, limit: int
    ) -> list[AnalyticsEvent]:
        statement = (
            select(AnalyticsEvent)
            .where(AnalyticsEvent.tenant_id == tenant_id)
            .order_by(AnalyticsEvent.occurred_at.desc())
            .limit(limit)
        )
        return list(self._session.scalars(statement).all())


class SqlAlchemyOAuthTokenStore(IOAuthTokenStore):
    """Almacén de tokens OAuth cifrados con sesión propia (upsert por tenant+proveedor).

    El proveedor de Google es un singleton del contenedor sin sesión de request,
    por lo que este repositorio abre su propia ``session_scope``. El cifrado en
    reposo lo realiza el :class:`TokenCipher`; aquí solo se persiste/lee texto
    cifrado.
    """

    def __init__(self, *, database: Database, cipher: TokenCipher) -> None:
        self._database = database
        self._cipher = cipher

    def load(
        self, *, tenant_id: uuid.UUID, provider: str
    ) -> StoredOAuthToken | None:
        with self._database.session_scope() as session:
            statement = (
                select(TenantOAuthToken)
                .where(
                    TenantOAuthToken.tenant_id == tenant_id,
                    TenantOAuthToken.provider == provider,
                    TenantOAuthToken.deleted.is_(False),
                )
                .order_by(TenantOAuthToken.created_at.desc())
            )
            row = session.scalars(statement).first()
            if row is None:
                return None
            expires_at = row.expires_at
            if expires_at is not None and expires_at.tzinfo is None:
                # SQLite no preserva la zona horaria; el valor se almacena como UTC.
                expires_at = expires_at.replace(tzinfo=timezone.utc)
            return StoredOAuthToken(
                tenant_id=row.tenant_id,
                provider=row.provider,
                encrypted_access_token=row.encrypted_access_token,
                encrypted_refresh_token=row.encrypted_refresh_token,
                expires_at=expires_at,
            )

    def save(
        self,
        *,
        tenant_id: uuid.UUID,
        provider: str,
        encrypted_access_token: str,
        encrypted_refresh_token: str,
        expires_at: datetime | None,
    ) -> None:
        with self._database.session_scope() as session:
            statement = (
                select(TenantOAuthToken)
                .where(
                    TenantOAuthToken.tenant_id == tenant_id,
                    TenantOAuthToken.provider == provider,
                    TenantOAuthToken.deleted.is_(False),
                )
            )
            row = session.scalars(statement).first()
            if row is None:
                session.add(
                    TenantOAuthToken(
                        tenant_id=tenant_id,
                        provider=provider,
                        encrypted_access_token=encrypted_access_token,
                        encrypted_refresh_token=encrypted_refresh_token,
                        expires_at=expires_at,
                    )
                )
            else:
                row.encrypted_access_token = encrypted_access_token
                row.encrypted_refresh_token = encrypted_refresh_token
                row.expires_at = expires_at


class SqlAlchemyCdnDeploymentRepository(ICdnDeploymentRepository):
    def __init__(self, session: Session) -> None:
        self._session = session

    def create(
        self,
        *,
        tenant_id: uuid.UUID,
        landing_id: uuid.UUID,
        version: int,
        url: str,
        status: str = "deployed",
        html: str | None = None,
    ) -> CdnDeployment:
        deployment = CdnDeployment(
            tenant_id=tenant_id,
            landing_id=landing_id,
            version=version,
            url=url,
            status=status,
            html=html,
        )
        self._session.add(deployment)
        self._session.flush()
        return deployment

    def get_latest(
        self, *, tenant_id: uuid.UUID, landing_id: uuid.UUID
    ) -> CdnDeployment | None:
        statement = (
            select(CdnDeployment)
            .where(
                CdnDeployment.tenant_id == tenant_id,
                CdnDeployment.landing_id == landing_id,
            )
            .order_by(CdnDeployment.version.desc())
            .limit(1)
        )
        return self._session.scalars(statement).first()


class SqlAlchemyPseoHostRepository(IPseoHostRepository):
    def __init__(self, session: Session) -> None:
        self._session = session

    def get_by_host(self, *, host: str) -> PseoHost | None:
        statement = select(PseoHost).where(PseoHost.host == host)
        return self._session.scalars(statement).first()

    def get_by_tenant(self, *, tenant_id: uuid.UUID) -> PseoHost | None:
        statement = select(PseoHost).where(PseoHost.tenant_id == tenant_id)
        return self._session.scalars(statement).first()

    def upsert(self, *, tenant_id: uuid.UUID, host: str) -> PseoHost:
        existing = self.get_by_host(host=host)
        if existing is not None:
            return existing
        row = PseoHost(tenant_id=tenant_id, host=host)
        self._session.add(row)
        self._session.flush()
        return row


class SqlAlchemyPseoBatchRepository(IPseoBatchRepository):
    def __init__(self, session: Session) -> None:
        self._session = session

    def get_by_hash(
        self, *, tenant_id: uuid.UUID, matrix_hash: str
    ) -> PseoBatch | None:
        statement = (
            select(PseoBatch)
            .where(
                PseoBatch.tenant_id == tenant_id,
                PseoBatch.matrix_hash == matrix_hash,
                PseoBatch.deleted.is_(False),
            )
            .order_by(PseoBatch.created_at.desc())
            .limit(1)
        )
        return self._session.scalars(statement).first()

    def create(
        self,
        *,
        tenant_id: uuid.UUID,
        campaign_id: uuid.UUID,
        matrix_hash: str,
        template_version: str,
        page_count: int,
    ) -> PseoBatch:
        batch = PseoBatch(
            tenant_id=tenant_id,
            campaign_id=campaign_id,
            matrix_hash=matrix_hash,
            template_version=template_version,
            page_count=page_count,
            status="compiled",
        )
        self._session.add(batch)
        self._session.flush()
        return batch


class SqlAlchemyPseoPageRepository(IPseoPageRepository):
    def __init__(self, session: Session) -> None:
        self._session = session

    def get_by_slug_path(
        self, *, tenant_id: uuid.UUID, slug_path: str, published: bool | None = None
    ) -> PseoPage | None:
        statement = select(PseoPage).where(
            PseoPage.tenant_id == tenant_id,
            PseoPage.slug_path == slug_path,
            PseoPage.deleted.is_(False),
        )
        if published is not None:
            statement = statement.where(PseoPage.published.is_(published))
        return self._session.scalars(statement).first()

    def upsert(
        self,
        *,
        tenant_id: uuid.UUID,
        batch_id: uuid.UUID,
        slug_path: str,
        city: str,
        service_slug: str,
        service_name: str,
        offer_price: str,
        canonical_url: str,
        compiled_html: str,
        version: int,
    ) -> PseoPage:
        existing = self.get_by_slug_path(tenant_id=tenant_id, slug_path=slug_path)
        if existing is not None:
            existing.batch_id = batch_id
            existing.city = city
            existing.service_slug = service_slug
            existing.service_name = service_name
            existing.offer_price = offer_price
            existing.canonical_url = canonical_url
            existing.compiled_html = compiled_html
            existing.version = version
            existing.published = True
            self._session.flush()
            return existing
        row = PseoPage(
            tenant_id=tenant_id,
            batch_id=batch_id,
            slug_path=slug_path,
            city=city,
            service_slug=service_slug,
            service_name=service_name,
            offer_price=offer_price,
            canonical_url=canonical_url,
            compiled_html=compiled_html,
            version=version,
            published=True,
        )
        self._session.add(row)
        self._session.flush()
        return row

    def list_published(
        self, *, tenant_id: uuid.UUID, offset: int, limit: int
    ) -> list[PseoPage]:
        statement = (
            select(PseoPage)
            .where(
                PseoPage.tenant_id == tenant_id,
                PseoPage.deleted.is_(False),
                PseoPage.published.is_(True),
            )
            .order_by(PseoPage.slug_path.asc())
            .offset(offset)
            .limit(limit)
        )
        return list(self._session.scalars(statement).all())

    def count_published(self, *, tenant_id: uuid.UUID) -> int:
        statement = (
            select(func.count())
            .select_from(PseoPage)
            .where(
                PseoPage.tenant_id == tenant_id,
                PseoPage.deleted.is_(False),
                PseoPage.published.is_(True),
            )
        )
        return int(self._session.scalars(statement).one())
