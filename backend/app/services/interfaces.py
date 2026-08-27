"""Puertos (ABC) de la capa de servicios — inversión de dependencias.

Los servicios dependen de interfaces (repositorios, compilador, logger) que se
inyectan desde el composition root; nunca instancian implementaciones con
``new`` (regla CLAUDE: NO ``new`` en lógica de negocio).
"""

from __future__ import annotations

import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any

from app.models.pseo_page import PseoPage
from app.schemas.audit import AuditLogRead
from app.schemas.cdn import CdnDeployResponse
from app.schemas.common import Page
from app.schemas.landing import LandingCompileRequest, LandingCompileResponse, LandingCreate, LandingRead, LandingUpdate
from app.schemas.pseo import PseoBatchRead


class ICompilerService(ABC):
    """Compilador de configuración → HTML (motor minimal funcional)."""

    @abstractmethod
    def compile(self, *, config: dict[str, Any], template_name: str = "default") -> str: ...


class IAuditService(ABC):
    """Log de auditoría estructurado (append-only, con correlación de request)."""

    @abstractmethod
    def record(
        self,
        *,
        tenant_id: uuid.UUID | None = None,
        operation: str,
        entity_type: str | None = None,
        entity_id: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None: ...

    @abstractmethod
    def list(
        self,
        *,
        tenant_id: uuid.UUID,
        page: int,
        page_size: int,
        operation: str | None = None,
    ) -> Page[AuditLogRead]: ...


class ILandingService(ABC):
    """Caso de uso de landings (CRUD + publicar + compilar)."""

    @abstractmethod
    def create(self, *, tenant_id: uuid.UUID, data: LandingCreate) -> LandingRead: ...

    @abstractmethod
    def get(self, *, tenant_id: uuid.UUID, landing_id: uuid.UUID) -> LandingRead: ...

    @abstractmethod
    def list(self, *, tenant_id: uuid.UUID, page: int, page_size: int) -> Page[LandingRead]: ...

    @abstractmethod
    def update(self, *, tenant_id: uuid.UUID, landing_id: uuid.UUID, data: LandingUpdate) -> LandingRead: ...

    @abstractmethod
    def delete(self, *, tenant_id: uuid.UUID, landing_id: uuid.UUID) -> None: ...

    @abstractmethod
    def publish(self, *, tenant_id: uuid.UUID, landing_id: uuid.UUID, published: bool) -> LandingRead: ...

    @abstractmethod
    def compile(
        self,
        *,
        tenant_id: uuid.UUID,
        data: LandingCompileRequest,
    ) -> LandingCompileResponse: ...


class IAiResponseCache(ABC):
    """Caché de respuestas de IA (clave → valor) con expiración por TTL (thread-safe)."""

    @abstractmethod
    def get(self, key: str) -> Any | None: ...

    @abstractmethod
    def set(self, key: str, value: Any, *, ttl_seconds: float | None = None) -> None: ...


@dataclass(frozen=True)
class AiGenerationResult:
    """Resultado de la generación IA de una landing (config + metadatos)."""

    config: dict[str, Any]
    model: str
    cached: bool
    prompt_tokens: int = 0
    completion_tokens: int = 0


class IAiService(ABC):
    """Puerto de generación IA de landings (DeepSeek) con caché y errores con contexto."""

    @abstractmethod
    def generate_landing(
        self,
        *,
        tenant_id: uuid.UUID,
        prompt: str,
        workflow_type: str | None = None,
        brand_voice: dict[str, Any] | None = None,
    ) -> AiGenerationResult: ...


@dataclass(frozen=True)
class SchemaGenerationResult:
    """Resultado de la generación IA de un JSON Schema (Draft 2020-12)."""

    schema: dict[str, Any]
    model: str
    cached: bool
    prompt_tokens: int = 0
    completion_tokens: int = 0


class ISchemaGenerationService(ABC):
    """Puerto de generación IA de JSON Schemas (DeepSeek) con caché y validación."""

    @abstractmethod
    def generate_schema(
        self,
        *,
        tenant_id: uuid.UUID,
        prompt: str,
        name: str | None = None,
    ) -> SchemaGenerationResult: ...


@dataclass(frozen=True)
class SchemaValidationIssue:
    """Incumplimiento detectado al validar un JSON Schema o datos contra él."""

    path: str
    message: str
    keyword: str | None = None


@dataclass(frozen=True)
class SchemaValidationResult:
    """Resultado agregado de la validación de un JSON Schema (Draft 2020-12)."""

    valid: bool
    issues: list[SchemaValidationIssue]
    errors: int


class ISchemaValidator(ABC):
    """Puerto de validación de JSON Schemas (Draft 2020-12) y datos."""

    @abstractmethod
    def validate(
        self,
        *,
        schema: dict[str, Any],
        data: dict[str, Any] | None = None,
    ) -> SchemaValidationResult: ...


class ICdnDeploymentService(ABC):
    """Caso de uso de despliegue de landings al CDN (Fase 10).

    Compila la configuración de la landing, calcula la versión incremental y la
    URL determinista ``{cdn_base_url}/{landing_id}/v{version}``, persiste el
    despliegue (append-only) y lo registra en el log de auditoría.
    """

    @abstractmethod
    def deploy(self, *, tenant_id: uuid.UUID, landing_id: uuid.UUID) -> CdnDeployResponse: ...


@dataclass(frozen=True)
class MatrixRowData:
    """Fila de la matriz programática PSEO (datos ya validados por el esquema)."""

    city: str
    service_slug: str
    service_name: str
    offer_price: str


@dataclass(frozen=True)
class ResolvedPage:
    """Página PSEO resuelta: config pre-escapado y HTML compilado (opcional)."""

    city: str
    service_slug: str
    service_name: str
    offer_price: str
    config: dict[str, Any]
    html: str | None = None


class IDataMatrixService(ABC):
    """Matriz programática PSEO: resolución segura (whitelist + escape) y compilación.

    El resolver es la ÚNICA frontera de seguridad: sustituye exactamente 4 tokens
    (``city``, ``service_name``, ``service_slug``, ``offer_price``), escapa con
    ``html.escape`` en el punto de sustitución y rechaza (422) cualquier resto
    Jinja (``{{``, ``{%``, ``{#``) — anti-SSTI y anti-XSS.
    """

    @abstractmethod
    def resolve_row(
        self, *, template_config: dict[str, Any], row: MatrixRowData
    ) -> dict[str, Any]: ...

    @abstractmethod
    def compile_page(self, *, config: dict[str, Any]) -> str: ...

    @abstractmethod
    def process_matrix(
        self,
        *,
        tenant_id: uuid.UUID,
        campaign_id: uuid.UUID,
        template_config: dict[str, Any],
        rows: list[MatrixRowData],
        compile_pages: bool = True,
    ) -> list[ResolvedPage]: ...


class IPseoService(ABC):
    """Persistencia versionada y serving público PSEO (Fase D).

    - ``persist_matrix`` es idempotente por hash de matriz (config + filas +
      versión de plantilla): re-ejecutar la misma matriz no crea un lote ni
      versiones nuevas de páginas.
    - El serving y el sitemap solo exponen páginas publicadas del tenant
      resuelto por ``Host`` (404 si no existe, sin fuga cross-tenant).
    """

    @abstractmethod
    def persist_matrix(
        self,
        *,
        tenant_id: uuid.UUID,
        campaign_id: uuid.UUID,
        template_config: dict[str, Any],
        resolved_pages: list[ResolvedPage],
    ) -> PseoBatchRead: ...

    @abstractmethod
    def serve_page(self, *, tenant_id: uuid.UUID, slug_path: str) -> PseoPage | None: ...

    @abstractmethod
    def sitemap_pages(
        self, *, tenant_id: uuid.UUID, offset: int, limit: int
    ) -> list[PseoPage]: ...

    @abstractmethod
    def count_pages(self, *, tenant_id: uuid.UUID) -> int: ...
