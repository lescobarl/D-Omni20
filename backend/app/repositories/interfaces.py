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
from typing import Any

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
from app.models.tenant import Tenant


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


class ILandingRepository(ABC):
    """Acceso a landings SIEMPRE acotado al tenant (defensa en profundidad).

    Toda query incluye ``tenant_id`` y filtra ``deleted=False``; en PostgreSQL
    RLS refuerza el mismo límite a nivel de base de datos.
    """

    @abstractmethod
    def create(self, *, tenant_id: uuid.UUID, campaign_id: uuid.UUID, name: str, config: dict[str, Any]) -> TenantLanding: ...

    @abstractmethod
    def get(self, *, tenant_id: uuid.UUID, landing_id: uuid.UUID) -> TenantLanding | None: ...

    @abstractmethod
    def get_by_campaign(self, *, tenant_id: uuid.UUID, campaign_id: uuid.UUID) -> TenantLanding | None: ...

    @abstractmethod
    def list(self, *, tenant_id: uuid.UUID, page: int, page_size: int) -> tuple[list[TenantLanding], int]: ...

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
