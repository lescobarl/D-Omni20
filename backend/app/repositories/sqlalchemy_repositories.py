"""Implementaciones SQLAlchemy de los repositorios (inyectadas vía DI).

Reglas aplicadas:
- Toda query de landing se acota por ``tenant_id`` y ``deleted=False``
  (defensa en profundidad junto con RLS de PostgreSQL).
- Soft-delete (nunca DELETE físico) — regla CLAUDE tupla sync.
- Sin ``try/except`` vacío: los errores se propagan al servicio con contexto.
"""

from __future__ import annotations

import hmac
import uuid
from datetime import date, datetime, timezone
from typing import Any, cast

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.bot.models import BotConversation, BotMessage
from app.core.database import Database
from app.core.encryption import TokenCipher
from app.models.analytics_event import AnalyticsEvent
from app.models.audit_log import AuditLog
from app.models.bot_documents import BotDocument, BotDocumentChunk
from app.models.bot_keywords import BotKeyword
from app.models.bot_operations import (
    BotCampaign,
    BotCampaignRecipient,
    BotCampaignRecipientFile,
    BotContact,
    BotIntervention,
    BotMaintenanceConfig,
    BotNavigationTree,
    BotTemplate,
)
from app.models.bot_synonyms import BotSynonym
from app.models.cdn_deployment import CdnDeployment
from app.models.landing import TenantLanding
from app.models.marketplace_template import MarketplaceTemplate
from app.models.portal_page import PortalPage
from app.models.pseo_batch import PseoBatch
from app.models.pseo_host import PseoHost
from app.models.pseo_page import PseoPage
from app.models.schema import DeveloperSchema
from app.models.schema_version import SchemaVersion
from app.models.tenant import Tenant, TenantOAuthToken
from app.models.tenant_config import (
    BotRebrandingConfig,
    CatalogItem,
    ContentItem,
    TenantAppearance,
    TenantChannel,
)
from app.models.user import Role, TenantMembership, User
from app.repositories.interfaces import (
    AnalyticsSnapshot,
    IAnalyticsRepository,
    IAuditRepository,
    ICatalogItemRepository,
    ICdnDeploymentRepository,
    IContentItemRepository,
    IDocumentRepository,
    IKeywordRepository,
    ILandingRepository,
    IMarketplaceRepository,
    IMembershipRepository,
    IPortalPageRepository,
    IOAuthTokenStore,
    IPseoBatchRepository,
    IPseoHostRepository,
    IPseoPageRepository,
    IRebrandingConfigRepository,
    ISchemaRepository,
    ISchemaVersionRepository,
    ISynonymRepository,
    ITenantAppearanceRepository,
    ITenantChannelRepository,
    ITenantRepository,
    IUserRepository,
    StoredOAuthToken,
)
from app.repositories.operations_interfaces import (
    ChannelStatsAggregate,
    DailyStatsAggregate,
    ICampaignRecipientRepository,
    ICampaignRepository,
    IContactRepository,
    IInterventionRepository,
    IMaintenanceConfigRepository,
    INavigationTreeRepository,
    IOperationsStatsRepository,
    IRecipientFileRepository,
    ITemplateRepository,
    OperationsStatsAggregate,
    TableStatsAggregate,
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

    def update(self, tenant_id: uuid.UUID, name: str) -> Tenant | None:
        tenant = self._session.get(Tenant, tenant_id)
        if tenant is None or tenant.deleted:
            return None
        tenant.name = name
        self._session.flush()
        return tenant

    def delete(self, tenant_id: uuid.UUID) -> bool:
        tenant = self._session.get(Tenant, tenant_id)
        if tenant is None or tenant.deleted:
            return False
        tenant.deleted = True
        self._session.flush()
        return True


class SqlAlchemyUserRepository(IUserRepository):
    """Usuarios del estudio (control-plane, sin RLS)."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def get_by_id(self, user_id: uuid.UUID) -> User | None:
        return self._session.get(User, user_id)

    def get_by_email(self, email: str) -> User | None:
        statement = select(User).where(
            User.email == email, User.deleted.is_(False)
        )
        return self._session.scalars(statement).first()

    def create(
        self,
        *,
        email: str,
        password_hash: str,
        display_name: str | None = None,
        is_super_admin: bool = False,
        is_active: bool = True,
    ) -> User:
        user = User(
            email=email,
            password_hash=password_hash,
            display_name=display_name,
            is_super_admin=is_super_admin,
            is_active=is_active,
        )
        self._session.add(user)
        self._session.flush()
        return user

    def list_all(self) -> list[User]:
        statement = select(User).where(User.deleted.is_(False)).order_by(User.email)
        return list(self._session.scalars(statement).all())

    def update(
        self,
        user_id: uuid.UUID,
        *,
        display_name: str | None = None,
        password_hash: str | None = None,
        is_super_admin: bool | None = None,
        is_active: bool | None = None,
    ) -> User | None:
        user = self._session.get(User, user_id)
        if user is None or user.deleted:
            return None
        if display_name is not None:
            user.display_name = display_name
        if password_hash is not None:
            user.password_hash = password_hash
        if is_super_admin is not None:
            user.is_super_admin = is_super_admin
        if is_active is not None:
            user.is_active = is_active
        self._session.flush()
        return user

    def set_last_login(self, user_id: uuid.UUID, at: datetime) -> User | None:
        user = self._session.get(User, user_id)
        if user is None or user.deleted:
            return None
        user.last_login_at = at
        self._session.flush()
        return user

    def soft_delete(self, user_id: uuid.UUID) -> bool:
        user = self._session.get(User, user_id)
        if user is None or user.deleted:
            return False
        user.deleted = True
        self._session.flush()
        return True


class SqlAlchemyMembershipRepository(IMembershipRepository):
    """Membresías usuario↔tenant (RBAC por tenant, sin RLS)."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def get_by_user_and_tenant(
        self, *, user_id: uuid.UUID, tenant_id: uuid.UUID
    ) -> TenantMembership | None:
        statement = select(TenantMembership).where(
            TenantMembership.user_id == user_id,
            TenantMembership.tenant_id == tenant_id,
            TenantMembership.deleted.is_(False),
        )
        return self._session.scalars(statement).first()

    def list_by_tenant(self, *, tenant_id: uuid.UUID) -> list[TenantMembership]:
        statement = (
            select(TenantMembership)
            .where(
                TenantMembership.tenant_id == tenant_id,
                TenantMembership.deleted.is_(False),
            )
            .order_by(TenantMembership.created_at)
        )
        return list(self._session.scalars(statement).all())

    def list_by_user(self, *, user_id: uuid.UUID) -> list[TenantMembership]:
        statement = (
            select(TenantMembership)
            .where(
                TenantMembership.user_id == user_id,
                TenantMembership.deleted.is_(False),
            )
            .order_by(TenantMembership.created_at)
        )
        return list(self._session.scalars(statement).all())

    def create(
        self, *, user_id: uuid.UUID, tenant_id: uuid.UUID, role: Role
    ) -> TenantMembership:
        membership = TenantMembership(
            user_id=user_id, tenant_id=tenant_id, role=role
        )
        self._session.add(membership)
        self._session.flush()
        return membership

    def update_role(
        self, *, user_id: uuid.UUID, tenant_id: uuid.UUID, role: Role
    ) -> TenantMembership | None:
        membership = self.get_by_user_and_tenant(
            user_id=user_id, tenant_id=tenant_id
        )
        if membership is None:
            return None
        membership.role = role
        self._session.flush()
        return membership

    def delete(self, *, user_id: uuid.UUID, tenant_id: uuid.UUID) -> bool:
        membership = self.get_by_user_and_tenant(
            user_id=user_id, tenant_id=tenant_id
        )
        if membership is None:
            return False
        membership.deleted = True
        self._session.flush()
        return True


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
        slug: str,
        name: str,
        config: dict[str, Any],
    ) -> TenantLanding:
        landing = TenantLanding(
            tenant_id=tenant_id,
            campaign_id=campaign_id,
            slug=slug,
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

    def get_by_slug(self, *, tenant_id: uuid.UUID, slug: str) -> TenantLanding | None:
        statement = (
            select(TenantLanding)
            .where(TenantLanding.slug == slug, self._active_scope(tenant_id))
        )
        return self._session.scalars(statement).first()

    def list(self, *, tenant_id: uuid.UUID, page: int, page_size: int) -> tuple[list[TenantLanding], int]:
        base = select(TenantLanding).where(self._active_scope(tenant_id))
        total = self._session.scalar(select(func.count()).select_from(base.subquery())) or 0
        statement = base.order_by(TenantLanding.updated_at.desc()).offset((page - 1) * page_size).limit(page_size)
        items = list(self._session.scalars(statement).all())
        return items, total

    def list_published(self, *, tenant_id: uuid.UUID) -> list[TenantLanding]:
        statement = (
            select(TenantLanding)
            .where(self._active_scope(tenant_id), TenantLanding.published.is_(True))
            .order_by(TenantLanding.published_at.desc())
        )
        return list(self._session.scalars(statement).all())

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


class SqlAlchemyPortalPageRepository(IPortalPageRepository):
    def __init__(self, session: Session) -> None:
        self._session = session

    @staticmethod
    def _active_scope(tenant_id: uuid.UUID) -> Any:
        """Filtro común: tenant activo + sin soft-delete."""
        return (PortalPage.tenant_id == tenant_id) & (PortalPage.deleted.is_(False))

    def create(
        self,
        *,
        tenant_id: uuid.UUID,
        slug: str,
        title: str,
        blocks: dict[str, Any],
    ) -> PortalPage:
        page = PortalPage(
            tenant_id=tenant_id,
            slug=slug,
            title=title,
            blocks=blocks,
        )
        self._session.add(page)
        self._session.flush()
        return page

    def get(self, *, tenant_id: uuid.UUID, page_id: uuid.UUID) -> PortalPage | None:
        statement = (
            select(PortalPage)
            .where(PortalPage.id == page_id, self._active_scope(tenant_id))
        )
        return self._session.scalars(statement).first()

    def get_by_slug(self, *, tenant_id: uuid.UUID, slug: str) -> PortalPage | None:
        statement = (
            select(PortalPage)
            .where(PortalPage.slug == slug, self._active_scope(tenant_id))
        )
        return self._session.scalars(statement).first()

    def list(self, *, tenant_id: uuid.UUID, page: int, page_size: int) -> tuple[list[PortalPage], int]:
        base = select(PortalPage).where(self._active_scope(tenant_id))
        total = self._session.scalar(select(func.count()).select_from(base.subquery())) or 0
        statement = base.order_by(PortalPage.updated_at.desc()).offset((page - 1) * page_size).limit(page_size)
        items = list(self._session.scalars(statement).all())
        return items, total

    def list_published(self, *, tenant_id: uuid.UUID) -> list[PortalPage]:
        statement = (
            select(PortalPage)
            .where(self._active_scope(tenant_id), PortalPage.published.is_(True))
            .order_by(PortalPage.updated_at.asc())
        )
        return list(self._session.scalars(statement).all())

    def update(
        self,
        *,
        tenant_id: uuid.UUID,
        page_id: uuid.UUID,
        fields: dict[str, Any],
    ) -> PortalPage | None:
        page = self.get(tenant_id=tenant_id, page_id=page_id)
        if page is None:
            return None
        for key, value in fields.items():
            if hasattr(page, key):
                setattr(page, key, value)
        self._session.flush()
        return page

    def soft_delete(self, *, tenant_id: uuid.UUID, page_id: uuid.UUID) -> bool:
        page = self.get(tenant_id=tenant_id, page_id=page_id)
        if page is None:
            return False
        page.deleted = True
        self._session.flush()
        return True

    def publish(self, *, tenant_id: uuid.UUID, page_id: uuid.UUID, published: bool) -> PortalPage | None:
        page = self.get(tenant_id=tenant_id, page_id=page_id)
        if page is None:
            return None
        page.published = published
        if published:
            from app.models.base import utcnow

            page.published_at = utcnow()
        else:
            page.published_at = None
        self._session.flush()
        return page


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

    def get_by_landing_version(
        self, *, tenant_id: uuid.UUID, landing_id: uuid.UUID, version: int
    ) -> CdnDeployment | None:
        statement = (
            select(CdnDeployment)
            .where(
                CdnDeployment.tenant_id == tenant_id,
                CdnDeployment.landing_id == landing_id,
                CdnDeployment.version == version,
            )
            .limit(1)
        )
        return self._session.scalars(statement).first()


class SqlAlchemyPseoHostRepository(IPseoHostRepository):
    def __init__(self, session: Session) -> None:
        self._session = session

    def get_by_host(self, *, host: str) -> PseoHost | None:
        statement = select(PseoHost).where(
            PseoHost.host == host, PseoHost.deleted.is_(False)
        )
        return self._session.scalars(statement).first()

    def get_by_tenant(self, *, tenant_id: uuid.UUID) -> PseoHost | None:
        statement = select(PseoHost).where(
            PseoHost.tenant_id == tenant_id, PseoHost.deleted.is_(False)
        )
        return self._session.scalars(statement).first()

    def find_by_host(self, *, host: str) -> PseoHost | None:
        statement = select(PseoHost).where(PseoHost.host == host)
        return self._session.scalars(statement).first()

    def upsert(self, *, tenant_id: uuid.UUID, host: str) -> PseoHost:
        existing = self.find_by_host(host=host)
        if existing is not None:
            if existing.deleted or existing.status != "active":
                existing.deleted = False
                existing.status = "active"
                existing.tenant_id = tenant_id
                self._session.flush()
            return existing
        row = PseoHost(tenant_id=tenant_id, host=host, status="active")
        self._session.add(row)
        self._session.flush()
        return row

    def create(
        self, *, tenant_id: uuid.UUID, host: str, verify_token: str
    ) -> PseoHost:
        row = PseoHost(
            tenant_id=tenant_id,
            host=host,
            verify_token=verify_token,
            status="pending",
        )
        self._session.add(row)
        self._session.flush()
        return row

    def reactivate(
        self, *, host: str, tenant_id: uuid.UUID, verify_token: str
    ) -> PseoHost | None:
        row = self.find_by_host(host=host)
        if row is None:
            return None
        row.deleted = False
        row.status = "pending"
        row.tenant_id = tenant_id
        row.verify_token = verify_token
        row.verified_at = None
        self._session.flush()
        return row

    def list_by_tenant(self, *, tenant_id: uuid.UUID) -> list[PseoHost]:
        statement = (
            select(PseoHost)
            .where(
                PseoHost.tenant_id == tenant_id, PseoHost.deleted.is_(False)
            )
            .order_by(PseoHost.created_at.asc())
        )
        return list(self._session.scalars(statement).all())

    def get_by_id(
        self, *, tenant_id: uuid.UUID, host_id: uuid.UUID
    ) -> PseoHost | None:
        statement = select(PseoHost).where(
            PseoHost.id == host_id,
            PseoHost.tenant_id == tenant_id,
            PseoHost.deleted.is_(False),
        )
        return self._session.scalars(statement).first()

    def set_status(
        self, *, tenant_id: uuid.UUID, host_id: uuid.UUID, status: str
    ) -> PseoHost | None:
        row = self.get_by_id(tenant_id=tenant_id, host_id=host_id)
        if row is None:
            return None
        row.status = status
        self._session.flush()
        return row

    def mark_verified(
        self, *, tenant_id: uuid.UUID, host_id: uuid.UUID
    ) -> PseoHost | None:
        row = self.get_by_id(tenant_id=tenant_id, host_id=host_id)
        if row is None:
            return None
        row.status = "active"
        row.verified_at = datetime.now(timezone.utc)
        self._session.flush()
        return row

    def soft_delete(self, *, tenant_id: uuid.UUID, host_id: uuid.UUID) -> bool:
        row = self.get_by_id(tenant_id=tenant_id, host_id=host_id)
        if row is None:
            return False
        row.deleted = True
        self._session.flush()
        return True


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


class SqlAlchemyTenantAppearanceRepository(ITenantAppearanceRepository):
    def __init__(self, session: Session) -> None:
        self._session = session

    @staticmethod
    def _active_scope(tenant_id: uuid.UUID) -> Any:
        """Filtro común: tenant activo + sin soft-delete."""
        return (TenantAppearance.tenant_id == tenant_id) & (TenantAppearance.deleted.is_(False))

    def get(self, *, tenant_id: uuid.UUID) -> TenantAppearance | None:
        statement = select(TenantAppearance).where(self._active_scope(tenant_id))
        return self._session.scalars(statement).first()

    def upsert(
        self,
        *,
        tenant_id: uuid.UUID,
        primary_color: str,
        accent_color: str,
        surface_color: str,
        text_color: str,
        brand_badge: str,
        logo_url: str | None,
        font_family: str | None,
    ) -> TenantAppearance:
        existing = self.get(tenant_id=tenant_id)
        if existing is not None:
            existing.primary_color = primary_color
            existing.accent_color = accent_color
            existing.surface_color = surface_color
            existing.text_color = text_color
            existing.brand_badge = brand_badge
            existing.logo_url = logo_url
            existing.font_family = font_family
            self._session.flush()
            return existing
        row = TenantAppearance(
            tenant_id=tenant_id,
            primary_color=primary_color,
            accent_color=accent_color,
            surface_color=surface_color,
            text_color=text_color,
            brand_badge=brand_badge,
            logo_url=logo_url,
            font_family=font_family,
        )
        self._session.add(row)
        self._session.flush()
        return row


class SqlAlchemyRebrandingConfigRepository(IRebrandingConfigRepository):
    """Configuraciones de rebranding por URL (Fase 5) — SQLAlchemy."""

    def __init__(self, session: Session) -> None:
        self._session = session

    @staticmethod
    def _active_scope(tenant_id: uuid.UUID) -> Any:
        """Filtro común: tenant activo + sin soft-delete."""
        return (BotRebrandingConfig.tenant_id == tenant_id) & (
            BotRebrandingConfig.deleted.is_(False)
        )

    def create(
        self,
        *,
        tenant_id: uuid.UUID,
        name: str,
        url: str | None,
        extracted: dict[str, Any],
        applied_at: datetime | None = None,
        version: int = 1,
    ) -> BotRebrandingConfig:
        row = BotRebrandingConfig(
            tenant_id=tenant_id,
            name=name.strip(),
            url=url.strip() if url else "",
            extracted=extracted,
            applied_at=applied_at,
            version=version,
        )
        self._session.add(row)
        self._session.flush()
        return row

    def get(
        self, *, tenant_id: uuid.UUID, config_id: uuid.UUID
    ) -> BotRebrandingConfig | None:
        statement = select(BotRebrandingConfig).where(
            BotRebrandingConfig.id == config_id, self._active_scope(tenant_id)
        )
        return self._session.scalars(statement).first()

    def get_by_url(
        self, *, tenant_id: uuid.UUID, url: str
    ) -> BotRebrandingConfig | None:
        statement = select(BotRebrandingConfig).where(
            self._active_scope(tenant_id),
            func.lower(BotRebrandingConfig.url) == url.strip().lower(),
        )
        return self._session.scalars(statement).first()

    def list(
        self, *, tenant_id: uuid.UUID, page: int, page_size: int
    ) -> tuple[list[BotRebrandingConfig], int]:
        base = select(BotRebrandingConfig).where(self._active_scope(tenant_id))
        total = self._session.scalar(select(func.count()).select_from(base.subquery())) or 0
        statement = (
            base.order_by(BotRebrandingConfig.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        items = list(self._session.scalars(statement).all())
        return items, total

    def list_all(self, *, tenant_id: uuid.UUID) -> list[BotRebrandingConfig]:
        statement = (
            select(BotRebrandingConfig)
            .where(self._active_scope(tenant_id))
            .order_by(BotRebrandingConfig.created_at.desc())
        )
        return list(self._session.scalars(statement).all())

    def update(
        self,
        *,
        tenant_id: uuid.UUID,
        config_id: uuid.UUID,
        fields: dict[str, Any],
    ) -> BotRebrandingConfig | None:
        row = self.get(tenant_id=tenant_id, config_id=config_id)
        if row is None:
            return None
        for key, value in fields.items():
            if key in ("name", "url") and isinstance(value, str):
                value = value.strip()
            setattr(row, key, value)
        self._session.flush()
        return row

    def soft_delete(
        self, *, tenant_id: uuid.UUID, config_id: uuid.UUID
    ) -> bool:
        row = self.get(tenant_id=tenant_id, config_id=config_id)
        if row is None:
            return False
        row.deleted = True
        self._session.flush()
        return True


class SqlAlchemyContentItemRepository(IContentItemRepository):
    def __init__(self, session: Session) -> None:
        self._session = session

    @staticmethod
    def _active_scope(tenant_id: uuid.UUID) -> Any:
        """Filtro común: tenant activo + sin soft-delete."""
        return (ContentItem.tenant_id == tenant_id) & (ContentItem.deleted.is_(False))

    def create(
        self,
        *,
        tenant_id: uuid.UUID,
        kind: str,
        title: str,
        content: str,
        tags: list[str],
    ) -> ContentItem:
        row = ContentItem(
            tenant_id=tenant_id,
            kind=kind,
            title=title,
            content=content,
            tags=tags,
        )
        self._session.add(row)
        self._session.flush()
        return row

    def get(self, *, tenant_id: uuid.UUID, item_id: uuid.UUID) -> ContentItem | None:
        statement = (
            select(ContentItem).where(ContentItem.id == item_id, self._active_scope(tenant_id))
        )
        return self._session.scalars(statement).first()

    def get_by_kind(self, *, tenant_id: uuid.UUID, kind: str) -> list[ContentItem]:
        statement = (
            select(ContentItem)
            .where(ContentItem.kind == kind, self._active_scope(tenant_id))
            .order_by(ContentItem.title.asc())
        )
        return list(self._session.scalars(statement).all())

    def list(
        self, *, tenant_id: uuid.UUID, page: int, page_size: int
    ) -> tuple[list[ContentItem], int]:
        base = select(ContentItem).where(self._active_scope(tenant_id))
        total = self._session.scalar(select(func.count()).select_from(base.subquery())) or 0
        statement = base.order_by(ContentItem.updated_at.desc()).offset((page - 1) * page_size).limit(page_size)
        items = list(self._session.scalars(statement).all())
        return items, total

    def update(
        self,
        *,
        tenant_id: uuid.UUID,
        item_id: uuid.UUID,
        fields: dict[str, Any],
    ) -> ContentItem | None:
        row = self.get(tenant_id=tenant_id, item_id=item_id)
        if row is None:
            return None
        for key, value in fields.items():
            if hasattr(row, key):
                setattr(row, key, value)
        self._session.flush()
        return row

    def soft_delete(self, *, tenant_id: uuid.UUID, item_id: uuid.UUID) -> bool:
        row = self.get(tenant_id=tenant_id, item_id=item_id)
        if row is None:
            return False
        row.deleted = True
        self._session.flush()
        return True


class SqlAlchemyCatalogItemRepository(ICatalogItemRepository):
    # Mapeo nombre de dominio -> atributo ORM persistido.
    # ``metadata`` es además un atributo de clase del declarative base (MetaData),
    # por lo que un ``setattr(row, "metadata", ...)`` no tocaría la columna real.
    _FIELD_MAP = {"metadata": "metadata_json"}

    def __init__(self, session: Session) -> None:
        self._session = session

    @staticmethod
    def _active_scope(tenant_id: uuid.UUID) -> Any:
        """Filtro común: tenant activo + sin soft-delete."""
        return (CatalogItem.tenant_id == tenant_id) & (CatalogItem.deleted.is_(False))

    def create(
        self,
        *,
        tenant_id: uuid.UUID,
        sku: str,
        name: str,
        description: str | None,
        price: Decimal,
        currency: str,
        available: bool,
        metadata: dict[str, Any],
    ) -> CatalogItem:
        row = CatalogItem(
            tenant_id=tenant_id,
            sku=sku,
            name=name,
            description=description,
            price=price,
            currency=currency,
            available=available,
            metadata_json=metadata,
        )
        self._session.add(row)
        self._session.flush()
        return row

    def get(self, *, tenant_id: uuid.UUID, item_id: uuid.UUID) -> CatalogItem | None:
        statement = (
            select(CatalogItem).where(CatalogItem.id == item_id, self._active_scope(tenant_id))
        )
        return self._session.scalars(statement).first()

    def get_by_sku(self, *, tenant_id: uuid.UUID, sku: str) -> CatalogItem | None:
        statement = (
            select(CatalogItem).where(CatalogItem.sku == sku, self._active_scope(tenant_id))
        )
        return self._session.scalars(statement).first()

    def list(
        self, *, tenant_id: uuid.UUID, page: int, page_size: int
    ) -> tuple[list[CatalogItem], int]:
        base = select(CatalogItem).where(self._active_scope(tenant_id))
        total = self._session.scalar(select(func.count()).select_from(base.subquery())) or 0
        statement = base.order_by(CatalogItem.updated_at.desc()).offset((page - 1) * page_size).limit(page_size)
        items = list(self._session.scalars(statement).all())
        return items, total

    def update(
        self,
        *,
        tenant_id: uuid.UUID,
        item_id: uuid.UUID,
        fields: dict[str, Any],
    ) -> CatalogItem | None:
        row = self.get(tenant_id=tenant_id, item_id=item_id)
        if row is None:
            return None
        for key, value in fields.items():
            column = self._FIELD_MAP.get(key, key)
            if hasattr(row, column):
                setattr(row, column, value)
        self._session.flush()
        return row

    def soft_delete(self, *, tenant_id: uuid.UUID, item_id: uuid.UUID) -> bool:
        row = self.get(tenant_id=tenant_id, item_id=item_id)
        if row is None:
            return False
        row.deleted = True
        self._session.flush()
        return True


class SqlAlchemyDocumentRepository(IDocumentRepository):
    # ``metadata`` es atributo de clase del declarative base (MetaData); la
    # columna real se persiste en ``metadata_json`` (ver modelo BotDocument).
    _FIELD_MAP = {"metadata": "metadata_json"}

    def __init__(self, session: Session) -> None:
        self._session = session

    @staticmethod
    def _active_scope(tenant_id: uuid.UUID) -> Any:
        """Filtro común: tenant activo + sin soft-delete."""
        return (BotDocument.tenant_id == tenant_id) & (BotDocument.deleted.is_(False))

    @staticmethod
    def _snippet(text: str, query: str, width: int = 200) -> str:
        """Fragmento legible alrededor de la primera coincidencia de ``query``."""
        collapsed = " ".join(text.split())
        index = collapsed.lower().find(query.lower())
        start = 0 if index < 0 else max(0, index - width // 2)
        snippet = collapsed[start : start + width]
        if start > 0:
            snippet = f"…{snippet}"
        if start + width < len(collapsed):
            snippet = f"{snippet}…"
        return snippet

    def create(
        self,
        *,
        tenant_id: uuid.UUID,
        title: str,
        source_type: str,
        source_ref: str | None,
        content: str,
        size_bytes: int,
        metadata: dict[str, Any],
        version: int = 1,
        chunks: list[tuple[int, str]] | None = None,
    ) -> BotDocument:
        row = BotDocument(
            tenant_id=tenant_id,
            title=title,
            source_type=source_type,
            source_ref=source_ref,
            content=content,
            size_bytes=size_bytes,
            metadata_json=metadata,
            version=version,
        )
        self._session.add(row)
        self._session.flush()
        for ordinal, chunk_content in chunks or []:
            self._session.add(
                BotDocumentChunk(
                    tenant_id=tenant_id,
                    document_id=row.id,
                    ordinal=ordinal,
                    content=chunk_content,
                    version=version,
                )
            )
        self._session.flush()
        return row

    def get(
        self, *, tenant_id: uuid.UUID, document_id: uuid.UUID
    ) -> BotDocument | None:
        statement = select(BotDocument).where(
            BotDocument.id == document_id, self._active_scope(tenant_id)
        )
        return self._session.scalars(statement).first()

    def list(
        self, *, tenant_id: uuid.UUID, page: int, page_size: int
    ) -> tuple[list[BotDocument], int]:
        base = select(BotDocument).where(self._active_scope(tenant_id))
        total = self._session.scalar(select(func.count()).select_from(base.subquery())) or 0
        statement = (
            base.order_by(BotDocument.updated_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        items = list(self._session.scalars(statement).all())
        return items, total

    def list_all(self, *, tenant_id: uuid.UUID) -> list[BotDocument]:
        statement = (
            select(BotDocument)
            .where(self._active_scope(tenant_id))
            .order_by(BotDocument.updated_at.desc())
        )
        return list(self._session.scalars(statement).all())

    def search(
        self,
        *,
        tenant_id: uuid.UUID,
        query: str,
        limit: int,
    ) -> list[tuple[BotDocument, str, float]]:
        pattern = f"%{query}%"
        # 1) Coincidencia directa sobre el contenido del documento (mayor peso).
        doc_stmt = (
            select(BotDocument)
            .where(self._active_scope(tenant_id), BotDocument.content.ilike(pattern))
            .order_by(BotDocument.updated_at.desc())
            .limit(limit)
        )
        results: list[tuple[BotDocument, str, float]] = []
        for row in self._session.scalars(doc_stmt).all():
            results.append((row, self._snippet(row.content, query), 2.0))
        if len(results) >= limit:
            return results

        # 2) Coincidencia en chunks (documentos no devueltos aún).
        remaining = limit - len(results)
        matched_ids = [row.id for row, _, _ in results]
        chunk_stmt = (
            select(BotDocument, BotDocumentChunk)
            .join(BotDocumentChunk, BotDocumentChunk.document_id == BotDocument.id)
            .where(
                self._active_scope(tenant_id),
                BotDocumentChunk.content.ilike(pattern),
                (BotDocument.id.not_in(matched_ids) if matched_ids else True),
            )
            .order_by(BotDocumentChunk.ordinal.asc())
            .limit(remaining)
        )
        for document, chunk in self._session.execute(chunk_stmt).all():
            results.append((document, self._snippet(chunk.content, query), 1.0))
        return results

    def soft_delete(
        self, *, tenant_id: uuid.UUID, document_id: uuid.UUID
    ) -> bool:
        row = self.get(tenant_id=tenant_id, document_id=document_id)
        if row is None:
            return False
        row.deleted = True
        self._session.flush()
        return True


class SqlAlchemySynonymRepository(ISynonymRepository):
    """Sinónimos del bot (normalización de vocabulario) — SQLAlchemy."""

    def __init__(self, session: Session) -> None:
        self._session = session

    @staticmethod
    def _active_scope(tenant_id: uuid.UUID) -> Any:
        """Filtro común: tenant activo + sin soft-delete."""
        return (BotSynonym.tenant_id == tenant_id) & (BotSynonym.deleted.is_(False))

    def create(
        self,
        *,
        tenant_id: uuid.UUID,
        term: str,
        synonyms: list[str],
        version: int = 1,
    ) -> BotSynonym:
        row = BotSynonym(
            tenant_id=tenant_id,
            term=term.strip(),
            synonyms=synonyms,
            version=version,
        )
        self._session.add(row)
        self._session.flush()
        return row

    def get(
        self, *, tenant_id: uuid.UUID, synonym_id: uuid.UUID
    ) -> BotSynonym | None:
        statement = select(BotSynonym).where(
            BotSynonym.id == synonym_id, self._active_scope(tenant_id)
        )
        return self._session.scalars(statement).first()

    def get_by_term(
        self, *, tenant_id: uuid.UUID, term: str
    ) -> BotSynonym | None:
        statement = select(BotSynonym).where(
            self._active_scope(tenant_id),
            func.lower(BotSynonym.term) == term.strip().lower(),
        )
        return self._session.scalars(statement).first()

    def list(
        self, *, tenant_id: uuid.UUID, page: int, page_size: int
    ) -> tuple[list[BotSynonym], int]:
        base = select(BotSynonym).where(self._active_scope(tenant_id))
        total = self._session.scalar(select(func.count()).select_from(base.subquery())) or 0
        statement = (
            base.order_by(BotSynonym.term.asc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        items = list(self._session.scalars(statement).all())
        return items, total

    def list_all(self, *, tenant_id: uuid.UUID) -> list[BotSynonym]:
        statement = (
            select(BotSynonym)
            .where(self._active_scope(tenant_id))
            .order_by(BotSynonym.term.asc())
        )
        return list(self._session.scalars(statement).all())

    def update(
        self,
        *,
        tenant_id: uuid.UUID,
        synonym_id: uuid.UUID,
        fields: dict[str, Any],
    ) -> BotSynonym | None:
        row = self.get(tenant_id=tenant_id, synonym_id=synonym_id)
        if row is None:
            return None
        for key, value in fields.items():
            if key == "term":
                value = value.strip()
            setattr(row, key, value)
        self._session.flush()
        return row

    def soft_delete(
        self, *, tenant_id: uuid.UUID, synonym_id: uuid.UUID
    ) -> bool:
        row = self.get(tenant_id=tenant_id, synonym_id=synonym_id)
        if row is None:
            return False
        row.deleted = True
        self._session.flush()
        return True


class SqlAlchemyKeywordRepository(IKeywordRepository):
    """Keywords con prioridades del bot (Fase 3) — SQLAlchemy."""

    def __init__(self, session: Session) -> None:
        self._session = session

    @staticmethod
    def _active_scope(tenant_id: uuid.UUID) -> Any:
        """Filtro común: tenant activo + sin soft-delete."""
        return (BotKeyword.tenant_id == tenant_id) & (BotKeyword.deleted.is_(False))

    def create(
        self,
        *,
        tenant_id: uuid.UUID,
        term: str,
        response: str,
        priority: int = 100,
        enabled: bool = True,
        version: int = 1,
    ) -> BotKeyword:
        row = BotKeyword(
            tenant_id=tenant_id,
            term=term.strip(),
            response=response,
            priority=priority,
            enabled=enabled,
            version=version,
        )
        self._session.add(row)
        self._session.flush()
        return row

    def get(
        self, *, tenant_id: uuid.UUID, keyword_id: uuid.UUID
    ) -> BotKeyword | None:
        statement = select(BotKeyword).where(
            BotKeyword.id == keyword_id, self._active_scope(tenant_id)
        )
        return self._session.scalars(statement).first()

    def get_by_term(
        self, *, tenant_id: uuid.UUID, term: str
    ) -> BotKeyword | None:
        statement = select(BotKeyword).where(
            self._active_scope(tenant_id),
            func.lower(BotKeyword.term) == term.strip().lower(),
        )
        return self._session.scalars(statement).first()

    def list(
        self, *, tenant_id: uuid.UUID, page: int, page_size: int
    ) -> tuple[list[BotKeyword], int]:
        base = select(BotKeyword).where(self._active_scope(tenant_id))
        total = self._session.scalar(select(func.count()).select_from(base.subquery())) or 0
        statement = (
            base.order_by(BotKeyword.priority.asc(), BotKeyword.term.asc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        items = list(self._session.scalars(statement).all())
        return items, total

    def list_all(self, *, tenant_id: uuid.UUID) -> list[BotKeyword]:
        statement = (
            select(BotKeyword)
            .where(self._active_scope(tenant_id))
            .order_by(BotKeyword.priority.asc(), BotKeyword.term.asc())
        )
        return list(self._session.scalars(statement).all())

    def list_enabled(self, *, tenant_id: uuid.UUID) -> list[BotKeyword]:
        statement = (
            select(BotKeyword)
            .where(self._active_scope(tenant_id), BotKeyword.enabled.is_(True))
            .order_by(BotKeyword.priority.asc(), BotKeyword.term.asc())
        )
        return list(self._session.scalars(statement).all())

    def update(
        self,
        *,
        tenant_id: uuid.UUID,
        keyword_id: uuid.UUID,
        fields: dict[str, Any],
    ) -> BotKeyword | None:
        row = self.get(tenant_id=tenant_id, keyword_id=keyword_id)
        if row is None:
            return None
        for key, value in fields.items():
            if key == "term":
                value = value.strip()
            setattr(row, key, value)
        self._session.flush()
        return row

    def soft_delete(
        self, *, tenant_id: uuid.UUID, keyword_id: uuid.UUID
    ) -> bool:
        row = self.get(tenant_id=tenant_id, keyword_id=keyword_id)
        if row is None:
            return False
        row.deleted = True
        self._session.flush()
        return True


class SqlAlchemyTenantChannelRepository(ITenantChannelRepository):
    """Canales del bot con secretos cifrados en reposo (``TokenCipher``).

    La interfaz trabaja en texto plano: este repositorio cifra al persistir y
    descifra al leer (expuesto en los atributos transitorios del modelo). Si no
    hay ``TokenCipher`` (dev/tests sin ``TOKEN_ENCRYPTION_KEY``), los valores se
    persisten tal cual como respaldo.
    """

    # Mapeo campo plano del dominio -> columna cifrada persistida.
    _SECRET_FIELDS = {
        "access_token": "encrypted_access_token",
        "webhook_secret": "encrypted_webhook_secret",
    }

    def __init__(self, session: Session, *, cipher: TokenCipher | None) -> None:
        self._session = session
        self._cipher = cipher

    @staticmethod
    def _active_scope(tenant_id: uuid.UUID) -> Any:
        """Filtro común: tenant activo + sin soft-delete."""
        return (TenantChannel.tenant_id == tenant_id) & (TenantChannel.deleted.is_(False))

    def _encrypt(self, value: str) -> str:
        if self._cipher is not None and value:
            return self._cipher.encrypt(value)
        return value

    def _decrypt(self, value: str) -> str:
        if self._cipher is not None and value:
            return self._cipher.decrypt(value)
        return value

    def _expose(self, row: TenantChannel) -> TenantChannel:
        """Expone los secretos descifrados en atributos transitorios (no mapeados)."""
        row.access_token = self._decrypt(row.encrypted_access_token)
        row.webhook_secret = self._decrypt(row.encrypted_webhook_secret)
        return row

    def create(
        self,
        *,
        tenant_id: uuid.UUID,
        channel_type: str,
        external_id: str | None,
        phone_number: str,
        phone_number_id: str | None,
        access_token: str,
        webhook_secret: str,
        enabled: bool,
    ) -> TenantChannel:
        row = TenantChannel(
            tenant_id=tenant_id,
            channel_type=channel_type,
            external_id=external_id,
            phone_number=phone_number,
            phone_number_id=phone_number_id,
            encrypted_access_token=self._encrypt(access_token),
            encrypted_webhook_secret=self._encrypt(webhook_secret),
            enabled=enabled,
        )
        self._session.add(row)
        self._session.flush()
        return self._expose(row)

    def get(self, *, tenant_id: uuid.UUID, channel_id: uuid.UUID) -> TenantChannel | None:
        statement = (
            select(TenantChannel).where(TenantChannel.id == channel_id, self._active_scope(tenant_id))
        )
        row = self._session.scalars(statement).first()
        return self._expose(row) if row is not None else None

    def get_by_type(self, *, tenant_id: uuid.UUID, channel_type: str) -> list[TenantChannel]:
        statement = (
            select(TenantChannel)
            .where(TenantChannel.channel_type == channel_type, self._active_scope(tenant_id))
            .order_by(TenantChannel.created_at.asc())
        )
        return [self._expose(row) for row in self._session.scalars(statement).all()]

    def get_by_natural_key(
        self, *, tenant_id: uuid.UUID, channel_type: str, external_id: str | None
    ) -> TenantChannel | None:
        """Busca por clave natural ``(channel_type, external_id)`` para importación idempotente."""
        statement = (
            select(TenantChannel)
            .where(
                TenantChannel.channel_type == channel_type,
                TenantChannel.external_id == external_id,
                self._active_scope(tenant_id),
            )
            .order_by(TenantChannel.created_at.asc())
        )
        row = self._session.scalars(statement).first()
        return self._expose(row) if row is not None else None

    def list(
        self, *, tenant_id: uuid.UUID, page: int, page_size: int
    ) -> tuple[list[TenantChannel], int]:
        base = select(TenantChannel).where(self._active_scope(tenant_id))
        total = self._session.scalar(select(func.count()).select_from(base.subquery())) or 0
        statement = base.order_by(TenantChannel.updated_at.desc()).offset((page - 1) * page_size).limit(page_size)
        items = [self._expose(row) for row in self._session.scalars(statement).all()]
        return items, total

    def update(
        self,
        *,
        tenant_id: uuid.UUID,
        channel_id: uuid.UUID,
        fields: dict[str, Any],
    ) -> TenantChannel | None:
        row = self.get(tenant_id=tenant_id, channel_id=channel_id)
        if row is None:
            return None
        for key, value in fields.items():
            column = self._SECRET_FIELDS.get(key)
            if column is not None:
                setattr(row, column, self._encrypt(value))
            elif hasattr(row, key):
                setattr(row, key, value)
        self._session.flush()
        return self._expose(row)

    def soft_delete(self, *, tenant_id: uuid.UUID, channel_id: uuid.UUID) -> bool:
        row = self.get(tenant_id=tenant_id, channel_id=channel_id)
        if row is None:
            return False
        row.deleted = True
        self._session.flush()
        return True

    # ------------------------------------------------------------------
    # Resolución canal -> tenant (solo contexto de servicio / webhook)
    # ------------------------------------------------------------------
    # Ver documentación del puerto ``ITenantChannelRepository``: métodos
    # para webhooks entrantes y context bundle, sin filtro de tenant (el
    # tenant se deriva del propio canal). En PostgreSQL requieren un rol de
    # servicio con BYPASSRLS (RLS con ``FORCE`` + ``current_setting`` NULL
    # no matchea filas); en SQLite (dev/tests) funcionan de forma natural.

    def resolve_by_channel_id(self, *, channel_id: uuid.UUID) -> TenantChannel | None:
        statement = (
            select(TenantChannel).where(
                TenantChannel.id == channel_id,
                TenantChannel.deleted.is_(False),
                TenantChannel.enabled.is_(True),
            )
        )
        row = self._session.scalars(statement).first()
        return self._expose(row) if row is not None else None

    def resolve_by_external_id(
        self, *, channel_type: str, external_id: str | None
    ) -> TenantChannel | None:
        statement = (
            select(TenantChannel)
            .where(
                TenantChannel.channel_type == channel_type,
                TenantChannel.external_id == external_id,
                TenantChannel.deleted.is_(False),
                TenantChannel.enabled.is_(True),
            )
            .order_by(TenantChannel.created_at.asc())
        )
        row = self._session.scalars(statement).first()
        return self._expose(row) if row is not None else None

    def resolve_by_phone_number_id(self, *, phone_number_id: str) -> TenantChannel | None:
        statement = (
            select(TenantChannel).where(
                TenantChannel.phone_number_id == phone_number_id,
                TenantChannel.deleted.is_(False),
                TenantChannel.enabled.is_(True),
            )
        )
        row = self._session.scalars(statement).first()
        return self._expose(row) if row is not None else None

    def resolve_by_phone_number(
        self, *, channel_type: str, phone_number: str
    ) -> TenantChannel | None:
        """Resuelve el canal por el número ``To`` de un SMS entrante (Twilio).

        Twilio no firma con un token estático por canal: el ruteo entrante usa
        el campo ``To`` del webhook contra ``phone_number`` del canal (canal de
        tipo ``sms``). Fail-closed: devuelve ``None`` si no hay coincidencia.
        """
        statement = (
            select(TenantChannel)
            .where(
                TenantChannel.channel_type == channel_type,
                TenantChannel.phone_number == phone_number,
                TenantChannel.deleted.is_(False),
                TenantChannel.enabled.is_(True),
            )
            .order_by(TenantChannel.created_at.asc())
        )
        row = self._session.scalars(statement).first()
        return self._expose(row) if row is not None else None

    def resolve_by_verify_token(
        self, *, verify_token: str, channel_type: str = "whatsapp"
    ) -> TenantChannel | None:
        """Resuelve el canal cuyo ``webhook_secret`` coincide con el verify_token.

        Solo canales habilitados (``enabled``) sin soft-delete y del tipo dado
        (por defecto ``whatsapp``). Como ``TokenCipher`` (Fernet) es no
        determinista, no se puede filtrar por cifrado: se itera, se descifra
        cada ``webhook_secret`` y se compara en texto plano con
        ``hmac.compare_digest`` (tiempo constante).
        Fail-closed: devuelve ``None`` si no hay coincidencia.
        """
        if not verify_token:
            return None
        statement = (
            select(TenantChannel).where(
                TenantChannel.channel_type == channel_type,
                TenantChannel.deleted.is_(False),
                TenantChannel.enabled.is_(True),
            )
        )
        for row in self._session.scalars(statement).all():
            secret = self._decrypt(row.encrypted_webhook_secret)
            if secret and hmac.compare_digest(secret, verify_token):
                return self._expose(row)
        return None


class SqlAlchemyContactRepository(IContactRepository):
    def __init__(self, session: Session) -> None:
        self._session = session

    @staticmethod
    def _active_scope(tenant_id: uuid.UUID) -> Any:
        """Filtro común: tenant activo + sin soft-delete."""
        return (BotContact.tenant_id == tenant_id) & (BotContact.deleted.is_(False))

    def create(
        self,
        *,
        tenant_id: uuid.UUID,
        phone: str,
        name: str | None,
        email: str | None,
        tags: list[str],
        state: str,
        source: str,
        external_contact_id: str | None,
        last_contact_at: datetime | None,
    ) -> BotContact:
        row = BotContact(
            tenant_id=tenant_id,
            phone=phone,
            name=name,
            email=email,
            tags=tags,
            state=state,
            source=source,
            external_contact_id=external_contact_id,
            last_contact_at=last_contact_at,
        )
        self._session.add(row)
        self._session.flush()
        return row

    def get(self, *, tenant_id: uuid.UUID, contact_id: uuid.UUID) -> BotContact | None:
        statement = (
            select(BotContact).where(BotContact.id == contact_id, self._active_scope(tenant_id))
        )
        return self._session.scalars(statement).first()

    def get_by_phone(self, *, tenant_id: uuid.UUID, phone: str) -> BotContact | None:
        statement = (
            select(BotContact).where(BotContact.phone == phone, self._active_scope(tenant_id))
        )
        return self._session.scalars(statement).first()

    def get_by_email(self, *, tenant_id: uuid.UUID, email: str) -> BotContact | None:
        statement = (
            select(BotContact).where(BotContact.email == email, self._active_scope(tenant_id))
        )
        return self._session.scalars(statement).first()

    def list(
        self, *, tenant_id: uuid.UUID, page: int, page_size: int
    ) -> tuple[list[BotContact], int]:
        base = select(BotContact).where(self._active_scope(tenant_id))
        total = self._session.scalar(select(func.count()).select_from(base.subquery())) or 0
        statement = base.order_by(BotContact.updated_at.desc()).offset((page - 1) * page_size).limit(page_size)
        items = list(self._session.scalars(statement).all())
        return items, total

    def list_by_tags(
        self, *, tenant_id: uuid.UUID, tags: list[str], match: str
    ) -> list[BotContact]:
        """Contactos activos del tenant cuyas etiquetas cumplen ``match``.

        Filtro en Python sobre el JSON ``tags`` (portable SQLite/PostgreSQL);
        ``match`` ∈ {"any", "all"}. Lo usa el dispatcher de campañas (C-2).
        """
        statement = select(BotContact).where(self._active_scope(tenant_id))
        rows = list(self._session.scalars(statement).all())
        required = set(tags)
        if match == "all":
            return [row for row in rows if required.issubset(set(row.tags or []))]
        return [row for row in rows if bool(set(row.tags or []) & required)]

    def update(
        self,
        *,
        tenant_id: uuid.UUID,
        contact_id: uuid.UUID,
        fields: dict[str, Any],
    ) -> BotContact | None:
        row = self.get(tenant_id=tenant_id, contact_id=contact_id)
        if row is None:
            return None
        for key, value in fields.items():
            if hasattr(row, key):
                setattr(row, key, value)
        self._session.flush()
        return row

    def soft_delete(self, *, tenant_id: uuid.UUID, contact_id: uuid.UUID) -> bool:
        row = self.get(tenant_id=tenant_id, contact_id=contact_id)
        if row is None:
            return False
        row.deleted = True
        self._session.flush()
        return True


class SqlAlchemyTemplateRepository(ITemplateRepository):
    def __init__(self, session: Session) -> None:
        self._session = session

    @staticmethod
    def _active_scope(tenant_id: uuid.UUID) -> Any:
        """Filtro común: tenant activo + sin soft-delete."""
        return (BotTemplate.tenant_id == tenant_id) & (BotTemplate.deleted.is_(False))

    def create(
        self,
        *,
        tenant_id: uuid.UUID,
        name: str,
        body: str,
        template_type: str,
        variables: list[str],
    ) -> BotTemplate:
        row = BotTemplate(
            tenant_id=tenant_id,
            name=name,
            body=body,
            template_type=template_type,
            variables=variables,
        )
        self._session.add(row)
        self._session.flush()
        return row

    def get(self, *, tenant_id: uuid.UUID, template_id: uuid.UUID) -> BotTemplate | None:
        statement = (
            select(BotTemplate).where(BotTemplate.id == template_id, self._active_scope(tenant_id))
        )
        return self._session.scalars(statement).first()

    def list(
        self, *, tenant_id: uuid.UUID, page: int, page_size: int
    ) -> tuple[list[BotTemplate], int]:
        base = select(BotTemplate).where(self._active_scope(tenant_id))
        total = self._session.scalar(select(func.count()).select_from(base.subquery())) or 0
        statement = base.order_by(BotTemplate.updated_at.desc()).offset((page - 1) * page_size).limit(page_size)
        items = list(self._session.scalars(statement).all())
        return items, total

    def update(
        self,
        *,
        tenant_id: uuid.UUID,
        template_id: uuid.UUID,
        fields: dict[str, Any],
    ) -> BotTemplate | None:
        row = self.get(tenant_id=tenant_id, template_id=template_id)
        if row is None:
            return None
        for key, value in fields.items():
            if hasattr(row, key):
                setattr(row, key, value)
        self._session.flush()
        return row

    def soft_delete(self, *, tenant_id: uuid.UUID, template_id: uuid.UUID) -> bool:
        row = self.get(tenant_id=tenant_id, template_id=template_id)
        if row is None:
            return False
        row.deleted = True
        self._session.flush()
        return True


class SqlAlchemyNavigationTreeRepository(INavigationTreeRepository):
    def __init__(self, session: Session) -> None:
        self._session = session

    @staticmethod
    def _active_scope(tenant_id: uuid.UUID) -> Any:
        """Filtro común: tenant activo + sin soft-delete."""
        return (BotNavigationTree.tenant_id == tenant_id) & (BotNavigationTree.deleted.is_(False))

    def create(
        self,
        *,
        tenant_id: uuid.UUID,
        name: str,
        num_options: int,
        options: list[dict[str, Any]],
    ) -> BotNavigationTree:
        row = BotNavigationTree(
            tenant_id=tenant_id,
            name=name,
            num_options=num_options,
            options=options,
        )
        self._session.add(row)
        self._session.flush()
        return row

    def get(
        self, *, tenant_id: uuid.UUID, tree_id: uuid.UUID
    ) -> BotNavigationTree | None:
        statement = (
            select(BotNavigationTree)
            .where(BotNavigationTree.id == tree_id, self._active_scope(tenant_id))
        )
        return self._session.scalars(statement).first()

    def list(
        self, *, tenant_id: uuid.UUID, page: int, page_size: int
    ) -> tuple[list[BotNavigationTree], int]:
        base = select(BotNavigationTree).where(self._active_scope(tenant_id))
        total = self._session.scalar(select(func.count()).select_from(base.subquery())) or 0
        statement = base.order_by(BotNavigationTree.updated_at.desc()).offset((page - 1) * page_size).limit(page_size)
        items = list(self._session.scalars(statement).all())
        return items, total

    def update(
        self,
        *,
        tenant_id: uuid.UUID,
        tree_id: uuid.UUID,
        fields: dict[str, Any],
    ) -> BotNavigationTree | None:
        row = self.get(tenant_id=tenant_id, tree_id=tree_id)
        if row is None:
            return None
        for key, value in fields.items():
            if hasattr(row, key):
                setattr(row, key, value)
        self._session.flush()
        return row

    def soft_delete(self, *, tenant_id: uuid.UUID, tree_id: uuid.UUID) -> bool:
        row = self.get(tenant_id=tenant_id, tree_id=tree_id)
        if row is None:
            return False
        row.deleted = True
        self._session.flush()
        return True


class SqlAlchemyCampaignRepository(ICampaignRepository):
    def __init__(self, session: Session) -> None:
        self._session = session

    @staticmethod
    def _active_scope(tenant_id: uuid.UUID) -> Any:
        """Filtro común: tenant activo + sin soft-delete."""
        return (BotCampaign.tenant_id == tenant_id) & (BotCampaign.deleted.is_(False))

    def create(
        self,
        *,
        tenant_id: uuid.UUID,
        name: str,
        template_id: uuid.UUID | None,
        state: str,
        schedule: datetime | None,
        segment_type: str | None,
        segment_config: dict[str, Any] | None,
        trigger_type: str | None,
        trigger_event: str | None,
        landing_id: uuid.UUID | None = None,
    ) -> BotCampaign:
        row = BotCampaign(
            tenant_id=tenant_id,
            name=name,
            template_id=template_id,
            state=state,
            schedule=schedule,
            segment_type=segment_type,
            segment_config=segment_config,
            trigger_type=trigger_type,
            trigger_event=trigger_event,
            landing_id=landing_id,
        )
        self._session.add(row)
        self._session.flush()
        return row

    def get(self, *, tenant_id: uuid.UUID, campaign_id: uuid.UUID) -> BotCampaign | None:
        statement = (
            select(BotCampaign).where(BotCampaign.id == campaign_id, self._active_scope(tenant_id))
        )
        return self._session.scalars(statement).first()

    def list(
        self, *, tenant_id: uuid.UUID, page: int, page_size: int
    ) -> tuple[list[BotCampaign], int]:
        base = select(BotCampaign).where(self._active_scope(tenant_id))
        total = self._session.scalar(select(func.count()).select_from(base.subquery())) or 0
        statement = base.order_by(BotCampaign.updated_at.desc()).offset((page - 1) * page_size).limit(page_size)
        items = list(self._session.scalars(statement).all())
        return items, total

    def update(
        self,
        *,
        tenant_id: uuid.UUID,
        campaign_id: uuid.UUID,
        fields: dict[str, Any],
    ) -> BotCampaign | None:
        row = self.get(tenant_id=tenant_id, campaign_id=campaign_id)
        if row is None:
            return None
        for key, value in fields.items():
            if hasattr(row, key):
                setattr(row, key, value)
        self._session.flush()
        return row

    def soft_delete(self, *, tenant_id: uuid.UUID, campaign_id: uuid.UUID) -> bool:
        row = self.get(tenant_id=tenant_id, campaign_id=campaign_id)
        if row is None:
            return False
        row.deleted = True
        self._session.flush()
        return True

    def list_due_for_dispatch(
        self, *, now: datetime, batch_limit: int
    ) -> list[BotCampaign]:
        """Campañas activas agendadas vencidas (multi-tenant, para el dispatcher).

        Excluye las campañas disparadas por evento (``trigger_type == "event"``);
        las agendadas con ``trigger_type`` None o "scheduled" vencidas entran.
        """
        statement = (
            select(BotCampaign)
            .where(
                BotCampaign.deleted.is_(False),
                BotCampaign.state == "active",
                BotCampaign.schedule.is_not(None),
                BotCampaign.schedule <= now,
                or_(
                    BotCampaign.trigger_type.is_(None),
                    BotCampaign.trigger_type != "event",
                ),
            )
            .order_by(BotCampaign.schedule.asc())
            .limit(batch_limit)
        )
        return list(self._session.scalars(statement).all())

    def list_by_trigger_event(
        self, *, event_type: str, limit: int
    ) -> list[BotCampaign]:
        """Campañas activas disparadas por evento (multi-tenant, para el dispatcher)."""
        statement = (
            select(BotCampaign)
            .where(
                BotCampaign.deleted.is_(False),
                BotCampaign.state == "active",
                BotCampaign.trigger_type == "event",
                BotCampaign.trigger_event == event_type,
            )
            .order_by(BotCampaign.updated_at.asc())
            .limit(limit)
        )
        return list(self._session.scalars(statement).all())


class SqlAlchemyCampaignRecipientRepository(ICampaignRecipientRepository):
    def __init__(self, session: Session) -> None:
        self._session = session

    @staticmethod
    def _active_scope(tenant_id: uuid.UUID) -> Any:
        """Filtro común: tenant activo + sin soft-delete."""
        return (
            BotCampaignRecipient.tenant_id == tenant_id
        ) & (BotCampaignRecipient.deleted.is_(False))

    def create(
        self,
        *,
        tenant_id: uuid.UUID,
        campaign_id: uuid.UUID,
        contact_id: uuid.UUID,
        state: str,
        result: str | None,
        attempts: int,
    ) -> BotCampaignRecipient:
        row = BotCampaignRecipient(
            tenant_id=tenant_id,
            campaign_id=campaign_id,
            contact_id=contact_id,
            state=state,
            result=result,
            attempts=attempts,
        )
        self._session.add(row)
        self._session.flush()
        return row

    def list_by_campaign(
        self,
        *,
        tenant_id: uuid.UUID,
        campaign_id: uuid.UUID,
        page: int,
        page_size: int,
    ) -> tuple[list[BotCampaignRecipient], int]:
        base = select(BotCampaignRecipient).where(
            BotCampaignRecipient.campaign_id == campaign_id,
            self._active_scope(tenant_id),
        )
        total = self._session.scalar(select(func.count()).select_from(base.subquery())) or 0
        statement = base.order_by(BotCampaignRecipient.updated_at.desc()).offset((page - 1) * page_size).limit(page_size)
        items = list(self._session.scalars(statement).all())
        return items, total

    def list_pending_by_campaign(
        self, *, tenant_id: uuid.UUID, campaign_id: uuid.UUID
    ) -> list[BotCampaignRecipient]:
        """Destinatarios pendientes de una campaña (para el dispatcher C-2)."""
        statement = select(BotCampaignRecipient).where(
            BotCampaignRecipient.campaign_id == campaign_id,
            BotCampaignRecipient.state == "pending",
            self._active_scope(tenant_id),
        )
        return list(self._session.scalars(statement).all())

    def get_by_campaign_and_contact(
        self, *, tenant_id: uuid.UUID, campaign_id: uuid.UUID, contact_id: uuid.UUID
    ) -> BotCampaignRecipient | None:
        """Resuelve el destinatario existente (idempotencia por campaña+contacto)."""
        statement = (
            select(BotCampaignRecipient)
            .where(
                BotCampaignRecipient.campaign_id == campaign_id,
                BotCampaignRecipient.contact_id == contact_id,
                self._active_scope(tenant_id),
            )
        )
        return self._session.scalars(statement).first()

    def update(
        self,
        *,
        tenant_id: uuid.UUID,
        recipient_id: uuid.UUID,
        fields: dict[str, Any],
    ) -> BotCampaignRecipient | None:
        statement = (
            select(BotCampaignRecipient)
            .where(BotCampaignRecipient.id == recipient_id, self._active_scope(tenant_id))
        )
        row = self._session.scalars(statement).first()
        if row is None:
            return None
        for key, value in fields.items():
            if hasattr(row, key):
                setattr(row, key, value)
        self._session.flush()
        return row


class SqlAlchemyRecipientFileRepository(IRecipientFileRepository):
    def __init__(self, session: Session) -> None:
        self._session = session

    @staticmethod
    def _active_scope(tenant_id: uuid.UUID) -> Any:
        """Filtro común: tenant activo + sin soft-delete."""
        return (
            BotCampaignRecipientFile.tenant_id == tenant_id
        ) & (BotCampaignRecipientFile.deleted.is_(False))

    def create(
        self,
        *,
        tenant_id: uuid.UUID,
        name: str,
        content_type: str,
        raw_csv: str,
        source_meta: dict[str, Any],
    ) -> BotCampaignRecipientFile:
        row = BotCampaignRecipientFile(
            tenant_id=tenant_id,
            name=name,
            content_type=content_type,
            raw_csv=raw_csv,
            source_meta=source_meta,
        )
        self._session.add(row)
        self._session.flush()
        return row

    def get(
        self, *, tenant_id: uuid.UUID, file_id: uuid.UUID
    ) -> BotCampaignRecipientFile | None:
        statement = (
            select(BotCampaignRecipientFile)
            .where(BotCampaignRecipientFile.id == file_id, self._active_scope(tenant_id))
        )
        return self._session.scalars(statement).first()

    def list(
        self, *, tenant_id: uuid.UUID, page: int, page_size: int
    ) -> tuple[list[BotCampaignRecipientFile], int]:
        base = select(BotCampaignRecipientFile).where(self._active_scope(tenant_id))
        total = self._session.scalar(select(func.count()).select_from(base.subquery())) or 0
        statement = (
            base.order_by(BotCampaignRecipientFile.updated_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        items = list(self._session.scalars(statement).all())
        return items, total


class SqlAlchemyInterventionRepository(IInterventionRepository):
    def __init__(self, session: Session) -> None:
        self._session = session

    @staticmethod
    def _active_scope(tenant_id: uuid.UUID) -> Any:
        """Filtro común: tenant activo + sin soft-delete."""
        return (BotIntervention.tenant_id == tenant_id) & (BotIntervention.deleted.is_(False))

    def create(
        self,
        *,
        tenant_id: uuid.UUID,
        conversation_id: uuid.UUID,
        state: str,
        operator: str | None,
        notes: str | None,
        assigned_at: datetime | None,
        resolved_at: datetime | None,
    ) -> BotIntervention:
        row = BotIntervention(
            tenant_id=tenant_id,
            conversation_id=conversation_id,
            state=state,
            operator=operator,
            notes=notes,
            assigned_at=assigned_at,
            resolved_at=resolved_at,
        )
        self._session.add(row)
        self._session.flush()
        return row

    def get(self, *, tenant_id: uuid.UUID, intervention_id: uuid.UUID) -> BotIntervention | None:
        statement = (
            select(BotIntervention)
            .where(BotIntervention.id == intervention_id, self._active_scope(tenant_id))
        )
        return self._session.scalars(statement).first()

    def list_by_state(
        self,
        *,
        tenant_id: uuid.UUID,
        state: str,
        page: int,
        page_size: int,
    ) -> tuple[list[BotIntervention], int]:
        base = select(BotIntervention).where(
            BotIntervention.state == state,
            self._active_scope(tenant_id),
        )
        total = self._session.scalar(select(func.count()).select_from(base.subquery())) or 0
        statement = base.order_by(BotIntervention.updated_at.desc()).offset((page - 1) * page_size).limit(page_size)
        items = list(self._session.scalars(statement).all())
        return items, total

    def list(
        self, *, tenant_id: uuid.UUID, page: int, page_size: int
    ) -> tuple[list[BotIntervention], int]:
        base = select(BotIntervention).where(self._active_scope(tenant_id))
        total = self._session.scalar(select(func.count()).select_from(base.subquery())) or 0
        statement = base.order_by(BotIntervention.updated_at.desc()).offset((page - 1) * page_size).limit(page_size)
        items = list(self._session.scalars(statement).all())
        return items, total

    def count_by_state(self, *, tenant_id: uuid.UUID, state: str) -> int:
        statement = (
            select(func.count())
            .select_from(BotIntervention)
            .where(BotIntervention.state == state, self._active_scope(tenant_id))
        )
        return self._session.scalar(statement) or 0

    def update(
        self,
        *,
        tenant_id: uuid.UUID,
        intervention_id: uuid.UUID,
        fields: dict[str, Any],
    ) -> BotIntervention | None:
        row = self.get(tenant_id=tenant_id, intervention_id=intervention_id)
        if row is None:
            return None
        for key, value in fields.items():
            if hasattr(row, key):
                setattr(row, key, value)
        self._session.flush()
        return row


class SqlAlchemyMaintenanceConfigRepository(IMaintenanceConfigRepository):
    def __init__(self, session: Session) -> None:
        self._session = session

    @staticmethod
    def _active_scope(tenant_id: uuid.UUID) -> Any:
        """Filtro común: tenant activo + sin soft-delete."""
        return (
            BotMaintenanceConfig.tenant_id == tenant_id
        ) & (BotMaintenanceConfig.deleted.is_(False))

    def get(self, *, tenant_id: uuid.UUID) -> BotMaintenanceConfig | None:
        statement = select(BotMaintenanceConfig).where(self._active_scope(tenant_id))
        return self._session.scalars(statement).first()

    def upsert(
        self,
        *,
        tenant_id: uuid.UUID,
        retention_rules: dict[str, Any],
        maintenance_schedule: str | None,
    ) -> BotMaintenanceConfig:
        row = self.get(tenant_id=tenant_id)
        if row is None:
            row = BotMaintenanceConfig(
                tenant_id=tenant_id,
                retention_rules=retention_rules,
                maintenance_schedule=maintenance_schedule,
            )
            self._session.add(row)
        else:
            row.retention_rules = retention_rules
            row.maintenance_schedule = maintenance_schedule
        self._session.flush()
        return row

    def soft_delete(self, *, tenant_id: uuid.UUID) -> bool:
        row = self.get(tenant_id=tenant_id)
        if row is None:
            return False
        row.deleted = True
        self._session.flush()
        return True


class SqlAlchemyOperationsStatsRepository(IOperationsStatsRepository):
    """Estadísticas agregadas del bot por tenant (B.1 Dashboard + B.2 Estadísticas).

    Todas las agregaciones quedan acotadas por ``tenant_id`` y soft-delete
    (defensa en profundidad junto con RLS). Las series diarias se derivan con
    ``func.date`` sobre ``created_at`` (portable SQLite/PostgreSQL).
    """

    def __init__(self, session: Session) -> None:
        self._session = session

    @staticmethod
    def _conversation_scope(tenant_id: uuid.UUID) -> Any:
        """Conversaciones activas del tenant (sin soft-delete)."""
        return (BotConversation.tenant_id == tenant_id) & (
            BotConversation.deleted.is_(False)
        )

    @staticmethod
    def _message_scope(tenant_id: uuid.UUID) -> Any:
        """Mensajes activos del tenant (sin soft-delete)."""
        return (BotMessage.tenant_id == tenant_id) & (BotMessage.deleted.is_(False))

    @staticmethod
    def _intervention_scope(tenant_id: uuid.UUID) -> Any:
        """Intervenciones activas del tenant (sin soft-delete)."""
        return (BotIntervention.tenant_id == tenant_id) & (
            BotIntervention.deleted.is_(False)
        )

    @staticmethod
    def _to_date(value: object) -> date:
        """Normaliza ``func.date`` (``date`` en PostgreSQL, ``str`` en SQLite)."""
        if isinstance(value, str):
            return datetime.strptime(value, "%Y-%m-%d").date()
        return cast(date, value)

    def overview(self, *, tenant_id: uuid.UUID) -> OperationsStatsAggregate:
        # Conversaciones activas y contactos únicos de la jornada del tenant.
        conversation_scope = self._conversation_scope(tenant_id)
        active_conversations = (
            self._session.scalar(
                select(func.count())
                .select_from(BotConversation)
                .where(conversation_scope)
            )
            or 0
        )
        unique_contacts = (
            self._session.scalar(
                select(func.count(func.distinct(BotConversation.external_contact_id)))
                .select_from(BotConversation)
                .where(conversation_scope)
            )
            or 0
        )

        # Mensajes entrantes/salientes (una fila por dirección).
        message_scope = self._message_scope(tenant_id)
        direction_rows = self._session.execute(
            select(BotMessage.direction, func.count())
            .where(message_scope)
            .group_by(BotMessage.direction)
        ).all()
        inbound_messages = 0
        outbound_messages = 0
        for direction, count in direction_rows:
            if direction == "inbound":
                inbound_messages = count
            elif direction == "outbound":
                outbound_messages = count
        total_messages = inbound_messages + outbound_messages

        # Cola humana (B.7): escaladas (pendientes + resueltas) y resueltas.
        intervention_scope = self._intervention_scope(tenant_id)
        escalated = (
            self._session.scalar(
                select(func.count())
                .select_from(BotIntervention)
                .where(intervention_scope)
            )
            or 0
        )
        resolved = (
            self._session.scalar(
                select(func.count())
                .select_from(BotIntervention)
                .where(intervention_scope & (BotIntervention.state == "resolved"))
            )
            or 0
        )
        resolved_ratio = (resolved / escalated) if escalated else 0.0

        # Serie diaria de mensajes (entrantes/salientes por día UTC).
        daily_rows = self._session.execute(
            select(
                func.date(BotMessage.created_at),
                BotMessage.direction,
                func.count(),
            )
            .where(message_scope)
            .group_by(func.date(BotMessage.created_at), BotMessage.direction)
        ).all()
        daily_map: dict[date, dict[str, int]] = {}
        for day, direction, count in daily_rows:
            bucket = daily_map.setdefault(self._to_date(day), {"inbound": 0, "outbound": 0})
            if direction == "inbound":
                bucket["inbound"] = count
            elif direction == "outbound":
                bucket["outbound"] = count
        daily = tuple(
            DailyStatsAggregate(
                date=day,
                inbound=counts["inbound"],
                outbound=counts["outbound"],
                total=counts["inbound"] + counts["outbound"],
            )
            for day, counts in sorted(daily_map.items())
        )

        # Por canal: conversaciones por canal con outer join a mensajes para
        # conservar canales sin mensajes (conteo 0). La condición de tenant de
        # los mensajes va en el JOIN (defensa en profundidad) sin filtrar las
        # conversaciones que aún no tienen mensajes.
        channel_rows = self._session.execute(
            select(
                BotConversation.channel_id,
                func.count(func.distinct(BotConversation.id)),
                func.count(BotMessage.id),
            )
            .outerjoin(
                BotMessage,
                (BotMessage.conversation_id == BotConversation.id)
                & (BotMessage.tenant_id == tenant_id)
                & (BotMessage.deleted.is_(False)),
            )
            .where(conversation_scope)
            .group_by(BotConversation.channel_id)
        ).all()
        by_channel = tuple(
            ChannelStatsAggregate(
                channel_id=channel_id,
                conversation_count=conversations,
                message_count=messages,
            )
            for channel_id, conversations, messages in channel_rows
        )

        return OperationsStatsAggregate(
            tenant_id=tenant_id,
            active_conversations=active_conversations,
            inbound_messages=inbound_messages,
            outbound_messages=outbound_messages,
            total_messages=total_messages,
            escalated=escalated,
            resolved=resolved,
            resolved_ratio=resolved_ratio,
            unique_contacts=unique_contacts,
            daily=daily,
            by_channel=by_channel,
        )

    def table_stats(self, *, tenant_id: uuid.UUID) -> tuple[TableStatsAggregate, ...]:
        """Conteo total/activo/inactivo por tabla del tenant (B.9 mantenimiento).

        ``total`` incluye filas soft-deleted; ``active`` solo las no eliminadas
        (``deleted = false``). Cada tabla se acota por ``tenant_id`` (defensa en
        profundidad junto con RLS). Las tablas de operación y configuración del
        bot se enumeran explícitamente para mantener un orden estable y legible.
        """
        tables: tuple[tuple[type[Any], str], ...] = (
            (BotContact, "bot_contacts"),
            (BotTemplate, "bot_templates"),
            (BotNavigationTree, "bot_navigation_trees"),
            (BotCampaign, "bot_campaigns"),
            (BotCampaignRecipient, "bot_campaign_recipients"),
            (BotIntervention, "bot_interventions"),
            (BotMaintenanceConfig, "bot_maintenance_configs"),
            (BotConversation, "bot_conversations"),
            (BotMessage, "bot_messages"),
            (BotDocument, "bot_documents"),
            (BotDocumentChunk, "bot_document_chunks"),
            (BotKeyword, "bot_keywords"),
            (BotSynonym, "bot_synonyms"),
            (TenantChannel, "tenant_channels"),
            (BotRebrandingConfig, "bot_rebranding_configs"),
            (CatalogItem, "catalog_items"),
            (ContentItem, "content_items"),
            (TenantAppearance, "tenant_appearances"),
        )
        results: list[TableStatsAggregate] = []
        for model, table_name in tables:
            total = (
                self._session.scalar(
                    select(func.count())
                    .select_from(model)
                    .where(model.tenant_id == tenant_id)
                )
                or 0
            )
            active = (
                self._session.scalar(
                    select(func.count())
                    .select_from(model)
                    .where((model.tenant_id == tenant_id) & (model.deleted.is_(False)))
                )
                or 0
            )
            results.append(
                TableStatsAggregate(
                    table_name=table_name,
                    total=total,
                    active=active,
                    inactive=total - active,
                )
            )
        return tuple(results)
