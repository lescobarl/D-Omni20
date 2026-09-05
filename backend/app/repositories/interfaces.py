"""Puertos (ABC) de repositorios — inversión de dependencias (regla CLAUDE: DI).

La lógica de negocio depende de estas interfaces, nunca de implementaciones
concretas. Las implementaciones concretas viven en
``app.repositories.sqlalchemy_repositories`` y se inyectan desde el
composition root (``app.api.deps``).
"""

from __future__ import annotations

import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Any

from app.models.analytics_event import AnalyticsEvent
from app.models.audit_log import AuditLog
from app.models.bot_documents import BotDocument
from app.models.bot_keywords import BotKeyword
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
from app.models.tenant import Tenant
from app.models.tenant_config import (
    BotRebrandingConfig,
    CatalogItem,
    ContentItem,
    TenantAppearance,
    TenantChannel,
)
from app.models.user import Role, TenantMembership, User


class ITenantRepository(ABC):
    """Acceso a tenants (raíz del multi-tenancy)."""

    @abstractmethod
    def get_by_id(self, tenant_id: uuid.UUID) -> Tenant | None: ...

    @abstractmethod
    def get_by_slug(self, slug: str) -> Tenant | None: ...

    @abstractmethod
    def create(self, slug: str, name: str) -> Tenant: ...

    @abstractmethod
    def list_all(self) -> list[Tenant]: ...

    @abstractmethod
    def update(self, tenant_id: uuid.UUID, name: str) -> Tenant | None: ...

    @abstractmethod
    def delete(self, tenant_id: uuid.UUID) -> bool: ...


class IUserRepository(ABC):
    """Acceso a usuarios del estudio (control-plane, sin RLS).

    Los usuarios son de plataforma: un super-admin los gestiona de forma global.
    El aislamiento por tenant se resuelve vía ``IMembershipRepository``.
    """

    @abstractmethod
    def get_by_id(self, user_id: uuid.UUID) -> User | None: ...

    @abstractmethod
    def get_by_email(self, email: str) -> User | None: ...

    @abstractmethod
    def create(
        self,
        *,
        email: str,
        password_hash: str,
        display_name: str | None = None,
        is_super_admin: bool = False,
        is_active: bool = True,
    ) -> User: ...

    @abstractmethod
    def list_all(self) -> list[User]: ...

    @abstractmethod
    def update(
        self,
        user_id: uuid.UUID,
        *,
        display_name: str | None = None,
        password_hash: str | None = None,
        is_super_admin: bool | None = None,
        is_active: bool | None = None,
    ) -> User | None: ...

    @abstractmethod
    def set_last_login(self, user_id: uuid.UUID, at: datetime) -> User | None: ...

    @abstractmethod
    def soft_delete(self, user_id: uuid.UUID) -> bool: ...


class IMembershipRepository(ABC):
    """Acceso a membresías usuario↔tenant (RBAC por tenant, sin RLS)."""

    @abstractmethod
    def get_by_user_and_tenant(
        self, *, user_id: uuid.UUID, tenant_id: uuid.UUID
    ) -> TenantMembership | None: ...

    @abstractmethod
    def list_by_tenant(self, *, tenant_id: uuid.UUID) -> list[TenantMembership]: ...

    @abstractmethod
    def list_by_user(self, *, user_id: uuid.UUID) -> list[TenantMembership]: ...

    @abstractmethod
    def create(
        self, *, user_id: uuid.UUID, tenant_id: uuid.UUID, role: Role
    ) -> TenantMembership: ...

    @abstractmethod
    def update_role(
        self, *, user_id: uuid.UUID, tenant_id: uuid.UUID, role: Role
    ) -> TenantMembership | None: ...

    @abstractmethod
    def delete(self, *, user_id: uuid.UUID, tenant_id: uuid.UUID) -> bool: ...


class ILandingRepository(ABC):
    """Acceso a landings SIEMPRE acotado al tenant (defensa en profundidad).

    Toda query incluye ``tenant_id`` y filtra ``deleted=False``; en PostgreSQL
    RLS refuerza el mismo límite a nivel de base de datos.
    """

    @abstractmethod
    def create(
        self,
        *,
        tenant_id: uuid.UUID,
        campaign_id: uuid.UUID,
        slug: str,
        name: str,
        config: dict[str, Any],
    ) -> TenantLanding: ...

    @abstractmethod
    def get(self, *, tenant_id: uuid.UUID, landing_id: uuid.UUID) -> TenantLanding | None: ...

    @abstractmethod
    def get_by_campaign(self, *, tenant_id: uuid.UUID, campaign_id: uuid.UUID) -> TenantLanding | None: ...

    @abstractmethod
    def get_by_slug(self, *, tenant_id: uuid.UUID, slug: str) -> TenantLanding | None: ...

    @abstractmethod
    def list(self, *, tenant_id: uuid.UUID, page: int, page_size: int) -> tuple[list[TenantLanding], int]: ...

    @abstractmethod
    def list_published(self, *, tenant_id: uuid.UUID) -> list[TenantLanding]: ...

    @abstractmethod
    def update(
        self,
        *,
        tenant_id: uuid.UUID,
        landing_id: uuid.UUID,
        fields: dict[str, Any],
    ) -> TenantLanding | None: ...

    @abstractmethod
    def soft_delete(self, *, tenant_id: uuid.UUID, landing_id: uuid.UUID) -> bool: ...

    @abstractmethod
    def publish(self, *, tenant_id: uuid.UUID, landing_id: uuid.UUID, published: bool) -> TenantLanding | None: ...


class IPortalPageRepository(ABC):
    """Acceso a páginas del Portal del Cliente SIEMPRE acotado al tenant.

    Toda query incluye ``tenant_id`` y filtra ``deleted=False``; en PostgreSQL
    RLS refuerza el mismo límite a nivel de base de datos.
    """

    @abstractmethod
    def create(self, *, tenant_id: uuid.UUID, slug: str, title: str, blocks: dict[str, Any]) -> PortalPage: ...

    @abstractmethod
    def get(self, *, tenant_id: uuid.UUID, page_id: uuid.UUID) -> PortalPage | None: ...

    @abstractmethod
    def get_by_slug(self, *, tenant_id: uuid.UUID, slug: str) -> PortalPage | None: ...

    @abstractmethod
    def list(self, *, tenant_id: uuid.UUID, page: int, page_size: int) -> tuple[list[PortalPage], int]: ...

    @abstractmethod
    def list_published(self, *, tenant_id: uuid.UUID) -> list[PortalPage]: ...

    @abstractmethod
    def update(
        self,
        *,
        tenant_id: uuid.UUID,
        page_id: uuid.UUID,
        fields: dict[str, Any],
    ) -> PortalPage | None: ...

    @abstractmethod
    def soft_delete(self, *, tenant_id: uuid.UUID, page_id: uuid.UUID) -> bool: ...

    @abstractmethod
    def publish(self, *, tenant_id: uuid.UUID, page_id: uuid.UUID, published: bool) -> PortalPage | None: ...


class ISchemaRepository(ABC):
    """Acceso a JSON Schemas (Draft 2020-12) SIEMPRE acotado al tenant.

    Toda query incluye ``tenant_id`` y filtra ``deleted=False``; en PostgreSQL
    RLS refuerza el mismo límite a nivel de base de datos.
    """

    @abstractmethod
    def save(
        self,
        *,
        tenant_id: uuid.UUID,
        name: str,
        schema_json: dict[str, Any],
        description: str | None = None,
        version: str = "1.0.0",
    ) -> DeveloperSchema: ...

    @abstractmethod
    def get(self, *, tenant_id: uuid.UUID, schema_id: uuid.UUID) -> DeveloperSchema | None: ...

    @abstractmethod
    def list(
        self, *, tenant_id: uuid.UUID, page: int, page_size: int
    ) -> tuple[list[DeveloperSchema], int]: ...

    @abstractmethod
    def soft_delete(self, *, tenant_id: uuid.UUID, schema_id: uuid.UUID) -> bool: ...


class ISchemaVersionRepository(ABC):
    """Acceso a versiones de JSON Schemas, SIEMPRE acotado al tenant.

    Cada versión es un snapshot inmutable del ``schema_json`` de un
    ``DeveloperSchema`` (1:N). Las queries filtran por ``tenant_id`` y
    ``schema_id``; el soft-delete no aplica (las versiones son append-only).
    """

    @abstractmethod
    def create_version(
        self,
        *,
        tenant_id: uuid.UUID,
        schema_id: uuid.UUID,
        version: str,
        schema_json: dict[str, Any],
        change_note: str | None = None,
    ) -> SchemaVersion: ...

    @abstractmethod
    def list_versions(
        self,
        *,
        tenant_id: uuid.UUID,
        schema_id: uuid.UUID,
        page: int,
        page_size: int,
    ) -> tuple[list[SchemaVersion], int]: ...


class IMarketplaceRepository(ABC):
    """Acceso al catálogo de templates del marketplace (Fase 8).

    El catálogo es global de solo lectura: se listan los templates ``is_public``
    de cualquier tenant, además de los propios del tenant solicitante (defensa en
    profundidad: nunca se exponen templates privados de terceros). Las mutaciones
    (crear / incrementar descargas) siempre registran el ``tenant_id`` del autor.
    """

    @abstractmethod
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
    ) -> MarketplaceTemplate: ...

    @abstractmethod
    def get(
        self, *, tenant_id: uuid.UUID, template_id: uuid.UUID
    ) -> MarketplaceTemplate | None: ...

    @abstractmethod
    def list(
        self,
        *,
        tenant_id: uuid.UUID,
        page: int,
        page_size: int,
        category: str | None = None,
    ) -> tuple[list[MarketplaceTemplate], int]: ...

    @abstractmethod
    def increment_downloads(
        self, *, tenant_id: uuid.UUID, template_id: uuid.UUID
    ) -> MarketplaceTemplate | None: ...


class IAuditRepository(ABC):
    """Log de auditoría estructurado (append-only, inmutable)."""

    @abstractmethod
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
    ) -> AuditLog: ...

    @abstractmethod
    def list(
        self,
        *,
        tenant_id: uuid.UUID,
        page: int,
        page_size: int,
        operation: str | None = None,
    ) -> tuple[list[AuditLog], int]: ...


@dataclass(frozen=True)
class AnalyticsSnapshot:
    """Resumen agregado de eventos de analítica para el dashboard del tenant."""

    total_events: int
    by_event_type: dict[str, int]


class IAnalyticsRepository(ABC):
    """Registro y agregación de eventos de analítica, SIEMPRE acotado al tenant."""

    @abstractmethod
    def record(
        self,
        *,
        tenant_id: uuid.UUID,
        event_type: str,
        entity_type: str | None = None,
        entity_id: str | None = None,
        properties: dict[str, Any] | None = None,
        occurred_at: datetime | None = None,
    ) -> AnalyticsEvent: ...

    @abstractmethod
    def aggregate(self, *, tenant_id: uuid.UUID) -> AnalyticsSnapshot: ...

    @abstractmethod
    def recent(
        self, *, tenant_id: uuid.UUID, limit: int
    ) -> list[AnalyticsEvent]: ...


@dataclass(frozen=True)
class StoredOAuthToken:
    """Token OAuth ya cifrado, tal como se persiste en ``tenant_oauth_tokens``."""

    tenant_id: uuid.UUID
    provider: str
    encrypted_access_token: str
    encrypted_refresh_token: str
    expires_at: datetime | None


class IOAuthTokenStore(ABC):
    """Almacén de tokens OAuth cifrados, acotado por tenant y proveedor.

    La persistencia de tokens en reposo es responsabilidad del repositorio; el
    cifrado/descifrado lo realiza el :class:`TokenCipher` en el proveedor.
    """

    @abstractmethod
    def load(
        self, *, tenant_id: uuid.UUID, provider: str
    ) -> StoredOAuthToken | None: ...

    @abstractmethod
    def save(
        self,
        *,
        tenant_id: uuid.UUID,
        provider: str,
        encrypted_access_token: str,
        encrypted_refresh_token: str,
        expires_at: datetime | None,
    ) -> None: ...


class ICdnDeploymentRepository(ABC):
    """Despliegues de landings al CDN, SIEMPRE acotados al tenant (append-only).

    Cada despliegue crea una versión incremental por landing con su URL
    determinista y el HTML servido por el CDN.
    """

    @abstractmethod
    def create(
        self,
        *,
        tenant_id: uuid.UUID,
        landing_id: uuid.UUID,
        version: int,
        url: str,
        status: str = "deployed",
        html: str | None = None,
    ) -> CdnDeployment: ...

    @abstractmethod
    def get_latest(
        self, *, tenant_id: uuid.UUID, landing_id: uuid.UUID
    ) -> CdnDeployment | None: ...

    @abstractmethod
    def get_by_landing_version(
        self, *, tenant_id: uuid.UUID, landing_id: uuid.UUID, version: int
    ) -> CdnDeployment | None:
        """Devuelve el despliegue de una versión concreta de una landing.

        Se usa por el serving público del CDN (``GET /cdn/{landing_id}/v{version}``)
        para recuperar el HTML compilado de la versión solicitada, siempre acotado
        al ``tenant_id`` (defensa en profundidad sobre RLS).
        """
        ...


class IPseoHostRepository(ABC):
    """Hosts PSEO: mapeo ``host`` → ``tenant_id`` para serving público.

    El endpoint público ``GET /pseo/{slug_path}`` resuelve el tenant desde el
    header ``Host`` contra esta tabla (sin ``X-Tenant-Id``).
    """

    @abstractmethod
    def get_by_host(self, *, host: str) -> PseoHost | None: ...

    @abstractmethod
    def get_by_tenant(self, *, tenant_id: uuid.UUID) -> PseoHost | None: ...

    @abstractmethod
    def upsert(self, *, tenant_id: uuid.UUID, host: str) -> PseoHost: ...

    @abstractmethod
    def find_by_host(self, *, host: str) -> PseoHost | None:
        """Busca un host incluyendo filas eliminadas (control de duplicados).

        Se usa para detectar colisiones globales del dominio y para reactivar
        una fila ``soft-deleted`` en :meth:`upsert` sin violar la
        ``UniqueConstraint`` de ``host``.
        """
        ...

    @abstractmethod
    def create(
        self, *, tenant_id: uuid.UUID, host: str, verify_token: str
    ) -> PseoHost:
        """Crea un host en estado ``pending`` a la espera de verificación DNS."""
        ...

    @abstractmethod
    def reactivate(
        self, *, host: str, tenant_id: uuid.UUID, verify_token: str
    ) -> PseoHost | None:
        """Re-activa una fila ``soft-deleted`` por host para re-registro.

        Reasigna el ``tenant_id``, pasa a ``pending`` con un nuevo
        ``verify_token`` y limpia ``verified_at``. Evita violar la
        ``UniqueConstraint`` de ``host`` al re-solicitar un dominio removido.
        """
        ...

    @abstractmethod
    def list_by_tenant(self, *, tenant_id: uuid.UUID) -> list[PseoHost]:
        """Lista los hosts del tenant (sin eliminados), por fecha de creación."""
        ...

    @abstractmethod
    def get_by_id(
        self, *, tenant_id: uuid.UUID, host_id: uuid.UUID
    ) -> PseoHost | None:
        """Devuelve un host del tenant (sin eliminados), acotado por tenant."""
        ...

    @abstractmethod
    def set_status(
        self, *, tenant_id: uuid.UUID, host_id: uuid.UUID, status: str
    ) -> PseoHost | None:
        """Cambia el estado del host (``pending`` | ``active``)."""
        ...

    @abstractmethod
    def mark_verified(
        self, *, tenant_id: uuid.UUID, host_id: uuid.UUID
    ) -> PseoHost | None:
        """Marca el host como ``active`` y fija ``verified_at`` (verificación DNS)."""
        ...

    @abstractmethod
    def soft_delete(self, *, tenant_id: uuid.UUID, host_id: uuid.UUID) -> bool:
        """Eliminación lógica del host (tupla sync ``deleted``)."""
        ...


class IPseoBatchRepository(ABC):
    """Lotes PSEO persistidos, idempotentes por ``matrix_hash`` (tenant-scoped).

    Re-ejecutar la misma matriz (mismo hash incl. versión de plantilla) no
    debe generar un lote nuevo.
    """

    @abstractmethod
    def get_by_hash(
        self, *, tenant_id: uuid.UUID, matrix_hash: str
    ) -> PseoBatch | None: ...

    @abstractmethod
    def create(
        self,
        *,
        tenant_id: uuid.UUID,
        campaign_id: uuid.UUID,
        matrix_hash: str,
        template_version: str,
        page_count: int,
    ) -> PseoBatch: ...


class IPseoPageRepository(ABC):
    """Páginas PSEO versionadas, SIEMPRE acotadas al tenant.

    ``UniqueConstraint(tenant_id, slug_path)``: la versión vive en la fila
    (se incrementa si el HTML cambia), nunca se borran filas (soft-delete).
    """

    @abstractmethod
    def get_by_slug_path(
        self, *, tenant_id: uuid.UUID, slug_path: str, published: bool | None = None
    ) -> PseoPage | None: ...

    @abstractmethod
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
    ) -> PseoPage: ...

    @abstractmethod
    def list_published(
        self, *, tenant_id: uuid.UUID, offset: int, limit: int
    ) -> list[PseoPage]: ...

    @abstractmethod
    def count_published(self, *, tenant_id: uuid.UUID) -> int: ...


class ITenantAppearanceRepository(ABC):
    """Apariencia del tenant (paleta, logo y tipografía) — uno por tenant.

    ``upsert`` garantiza una sola fila por tenant
    (``UniqueConstraint(tenant_id)``) para la configuración de apariencia.
    """

    @abstractmethod
    def get(self, *, tenant_id: uuid.UUID) -> TenantAppearance | None: ...

    @abstractmethod
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
    ) -> TenantAppearance: ...


class IRebrandingConfigRepository(ABC):
    """Configuraciones de rebranding por URL (Fase 5), únicas por tenant.

    Cada configuración asocia un ``name`` y una ``url`` (única por tenant)
    con el JSON ``extracted`` resultante de analizar los estilos de esa URL
    (paleta, tipografías y logo). SIEMPRE acotado al tenant; soft-delete en
    lugar de borrado físico.
    """

    @abstractmethod
    def create(
        self,
        *,
        tenant_id: uuid.UUID,
        name: str,
        url: str | None,
        extracted: dict[str, Any],
        applied_at: datetime | None = None,
        version: int = 1,
    ) -> BotRebrandingConfig: ...

    @abstractmethod
    def get(
        self, *, tenant_id: uuid.UUID, config_id: uuid.UUID
    ) -> BotRebrandingConfig | None: ...

    @abstractmethod
    def get_by_url(
        self, *, tenant_id: uuid.UUID, url: str
    ) -> BotRebrandingConfig | None: ...

    @abstractmethod
    def list(
        self, *, tenant_id: uuid.UUID, page: int, page_size: int
    ) -> tuple[list[BotRebrandingConfig], int]: ...

    @abstractmethod
    def list_all(self, *, tenant_id: uuid.UUID) -> list[BotRebrandingConfig]: ...

    @abstractmethod
    def update(
        self,
        *,
        tenant_id: uuid.UUID,
        config_id: uuid.UUID,
        fields: dict[str, Any],
    ) -> BotRebrandingConfig | None: ...

    @abstractmethod
    def soft_delete(
        self, *, tenant_id: uuid.UUID, config_id: uuid.UUID
    ) -> bool: ...


class IContentItemRepository(ABC):
    """Contenido estructurado del bot (saludos, menús, respuestas, FAQs).

    SIEMPRE acotado al tenant; soft-delete en lugar de borrado físico.
    """

    @abstractmethod
    def create(
        self,
        *,
        tenant_id: uuid.UUID,
        kind: str,
        title: str,
        content: str,
        tags: list[str],
    ) -> ContentItem: ...

    @abstractmethod
    def get(self, *, tenant_id: uuid.UUID, item_id: uuid.UUID) -> ContentItem | None: ...

    @abstractmethod
    def get_by_kind(self, *, tenant_id: uuid.UUID, kind: str) -> list[ContentItem]: ...

    @abstractmethod
    def list(
        self, *, tenant_id: uuid.UUID, page: int, page_size: int
    ) -> tuple[list[ContentItem], int]: ...

    @abstractmethod
    def update(
        self,
        *,
        tenant_id: uuid.UUID,
        item_id: uuid.UUID,
        fields: dict[str, Any],
    ) -> ContentItem | None: ...

    @abstractmethod
    def soft_delete(self, *, tenant_id: uuid.UUID, item_id: uuid.UUID) -> bool: ...


class ICatalogItemRepository(ABC):
    """Catálogo de productos/servicios del tenant (precios y disponibilidad).

    SIEMPRE acotado al tenant; ``sku`` único por tenant.
    """

    @abstractmethod
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
    ) -> CatalogItem: ...

    @abstractmethod
    def get(self, *, tenant_id: uuid.UUID, item_id: uuid.UUID) -> CatalogItem | None: ...

    @abstractmethod
    def get_by_sku(self, *, tenant_id: uuid.UUID, sku: str) -> CatalogItem | None: ...

    @abstractmethod
    def list(
        self, *, tenant_id: uuid.UUID, page: int, page_size: int
    ) -> tuple[list[CatalogItem], int]: ...

    @abstractmethod
    def update(
        self,
        *,
        tenant_id: uuid.UUID,
        item_id: uuid.UUID,
        fields: dict[str, Any],
    ) -> CatalogItem | None: ...

    @abstractmethod
    def soft_delete(self, *, tenant_id: uuid.UUID, item_id: uuid.UUID) -> bool: ...


class IDocumentRepository(ABC):
    """Documentos ingeridos para la base de conocimiento (RAG) del tenant.

    SIEMPRE acotado al tenant; ``source_type`` ∈ {pdf, txt, csv, url}. Los
    chunks son fragmentos opcionales que se crean junto al documento (lista de
    tuplas ``(ordinal, content)``) para permitir búsqueda semántica.
    """

    @abstractmethod
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
    ) -> BotDocument: ...

    @abstractmethod
    def get(
        self, *, tenant_id: uuid.UUID, document_id: uuid.UUID
    ) -> BotDocument | None: ...

    @abstractmethod
    def list(
        self, *, tenant_id: uuid.UUID, page: int, page_size: int
    ) -> tuple[list[BotDocument], int]: ...

    @abstractmethod
    def list_all(self, *, tenant_id: uuid.UUID) -> list[BotDocument]:
        """Colección completa de documentos activos del tenant (export/purga)."""
        ...

    @abstractmethod
    def search(
        self,
        *,
        tenant_id: uuid.UUID,
        query: str,
        limit: int,
    ) -> list[tuple[BotDocument, str, float]]:
        """Busca por texto en contenido/chunks y devuelve ``(doc, snippet, score)``."""
        ...

    @abstractmethod
    def soft_delete(
        self, *, tenant_id: uuid.UUID, document_id: uuid.UUID
    ) -> bool: ...


class ISynonymRepository(ABC):
    """Sinónimos del bot (normalización de vocabulario), únicos por tenant.

    Un sinónimo agrupa un ``term`` canónico (único por tenant, comparación
    case-insensitive) con su lista de variantes. SIEMPRE acotado al tenant;
    ``list_all`` expone la colección completa para exportación.
    """

    @abstractmethod
    def create(
        self,
        *,
        tenant_id: uuid.UUID,
        term: str,
        synonyms: list[str],
        version: int = 1,
    ) -> BotSynonym: ...

    @abstractmethod
    def get(
        self, *, tenant_id: uuid.UUID, synonym_id: uuid.UUID
    ) -> BotSynonym | None: ...

    @abstractmethod
    def get_by_term(
        self, *, tenant_id: uuid.UUID, term: str
    ) -> BotSynonym | None: ...

    @abstractmethod
    def list(
        self, *, tenant_id: uuid.UUID, page: int, page_size: int
    ) -> tuple[list[BotSynonym], int]: ...

    @abstractmethod
    def list_all(self, *, tenant_id: uuid.UUID) -> list[BotSynonym]: ...

    @abstractmethod
    def update(
        self,
        *,
        tenant_id: uuid.UUID,
        synonym_id: uuid.UUID,
        fields: dict[str, Any],
    ) -> BotSynonym | None: ...

    @abstractmethod
    def soft_delete(
        self, *, tenant_id: uuid.UUID, synonym_id: uuid.UUID
    ) -> bool: ...


class IKeywordRepository(ABC):
    """Keywords con prioridades del bot (Fase 3), únicas por tenant.

    Una keyword asocia un ``term`` canónico (único por tenant, comparación
    case-insensitive) con una ``response`` fija y un ``priority`` (menor
    número = mayor prioridad). SIEMPRE acotado al tenant; ``list_enabled``
    expone las keywords activas ordenadas por prioridad para el matching
    determinista del motor de conversación.
    """

    @abstractmethod
    def create(
        self,
        *,
        tenant_id: uuid.UUID,
        term: str,
        response: str,
        priority: int = 100,
        enabled: bool = True,
        version: int = 1,
    ) -> BotKeyword: ...

    @abstractmethod
    def get(
        self, *, tenant_id: uuid.UUID, keyword_id: uuid.UUID
    ) -> BotKeyword | None: ...

    @abstractmethod
    def get_by_term(
        self, *, tenant_id: uuid.UUID, term: str
    ) -> BotKeyword | None: ...

    @abstractmethod
    def list(
        self, *, tenant_id: uuid.UUID, page: int, page_size: int
    ) -> tuple[list[BotKeyword], int]: ...

    @abstractmethod
    def list_all(self, *, tenant_id: uuid.UUID) -> list[BotKeyword]: ...

    @abstractmethod
    def list_enabled(self, *, tenant_id: uuid.UUID) -> list[BotKeyword]: ...

    @abstractmethod
    def update(
        self,
        *,
        tenant_id: uuid.UUID,
        keyword_id: uuid.UUID,
        fields: dict[str, Any],
    ) -> BotKeyword | None: ...

    @abstractmethod
    def soft_delete(
        self, *, tenant_id: uuid.UUID, keyword_id: uuid.UUID
    ) -> bool: ...


class ITenantChannelRepository(ABC):
    """Canales del bot (WhatsApp Cloud API) con secretos cifrados en reposo.

    La interfaz trabaja con secretos en texto plano (``access_token`` /
    ``webhook_secret``); la implementación los cifra con ``TokenCipher`` antes
    de persistir y los descifra al leerlos.
    """

    @abstractmethod
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
    ) -> TenantChannel: ...

    @abstractmethod
    def get(self, *, tenant_id: uuid.UUID, channel_id: uuid.UUID) -> TenantChannel | None: ...

    @abstractmethod
    def get_by_type(self, *, tenant_id: uuid.UUID, channel_type: str) -> list[TenantChannel]: ...

    @abstractmethod
    def get_by_natural_key(
        self, *, tenant_id: uuid.UUID, channel_type: str, external_id: str | None
    ) -> TenantChannel | None: ...

    @abstractmethod
    def list(
        self, *, tenant_id: uuid.UUID, page: int, page_size: int
    ) -> tuple[list[TenantChannel], int]: ...

    @abstractmethod
    def update(
        self,
        *,
        tenant_id: uuid.UUID,
        channel_id: uuid.UUID,
        fields: dict[str, Any],
    ) -> TenantChannel | None: ...

    @abstractmethod
    def soft_delete(self, *, tenant_id: uuid.UUID, channel_id: uuid.UUID) -> bool: ...

    # ------------------------------------------------------------------
    # Resolución canal -> tenant (solo contexto de servicio / webhook)
    # ------------------------------------------------------------------
    # En los webhooks entrantes no existe ``X-Tenant-Id`` (plan §11.2): el
    # tenant se resuelve mapeando el canal por sus claves externas. Estos
    # métodos NO filtran por tenant y solo deben invocarse en contexto de
    # servicio (webhook / context bundle). En PostgreSQL se requiere un rol
    # de servicio con BYPASSRLS (la política RLS con ``FORCE`` y
    # ``current_setting`` NULL no matchea filas); en SQLite (dev/tests) la
    # resolución funciona de forma natural.

    @abstractmethod
    def resolve_by_channel_id(self, *, channel_id: uuid.UUID) -> TenantChannel | None: ...

    @abstractmethod
    def resolve_by_external_id(
        self, *, channel_type: str, external_id: str | None
    ) -> TenantChannel | None: ...

    @abstractmethod
    def resolve_by_phone_number_id(self, *, phone_number_id: str) -> TenantChannel | None: ...

    @abstractmethod
    def resolve_by_phone_number(
        self, *, channel_type: str, phone_number: str
    ) -> TenantChannel | None: ...

    @abstractmethod
    def resolve_by_verify_token(
        self, *, verify_token: str, channel_type: str = "whatsapp"
    ) -> TenantChannel | None:
        """Resuelve el canal por el ``verify_token`` del handshake del webhook.

        Diseño (plan §8.3, línea 249): el ``hub.verify_token`` que Meta envía en
        el handshake ``GET`` NO es un valor local: se resuelve desde los canales
        configurados (``tenant_channels``), comparándolo con el
        ``webhook_secret`` descifrado de cada canal habilitado. Como ``TokenCipher``
        (Fernet) es no determinista, la comparación exige iterar + descifrar (no
        se puede comparar cifrado contra texto plano).

        Solo contexto de servicio (BYPASSRLS en PostgreSQL); fail-closed: si no
        hay coincidencia devuelve ``None``.
        """
        ...
