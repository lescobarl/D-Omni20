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
from app.models.user import User
from app.schemas.audit import AuditLogRead
from app.schemas.cdn import CdnDeployResponse
from app.schemas.common import Page
from app.schemas.ads import AdCampaignCreate, AdCampaignRead, AdCampaignUpdate
from app.schemas.crm import (
    CrmSummaryRead,
    DealCreate,
    DealRead,
    DealUpdate,
    FunnelRead,
    SlaRead,
    SlaUpsert,
    StageChangeRead,
    StageCreate,
    StageRead,
    StageUpdate,
    TaskCreate,
    TaskRead,
    TaskUpdate,
)
from app.schemas.landing import LandingCompileRequest, LandingCompileResponse, LandingCreate, LandingRead, LandingUpdate
from app.schemas.portal_page import PortalPageCreate, PortalPageRead, PortalPageUpdate
from app.schemas.pseo import PseoBatchRead, PseoHostRead
from app.schemas.tenant_config import AppearanceProposal


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


class IPortalPageService(ABC):
    """Caso de uso de páginas del Portal del Cliente (CRUD + publicar)."""

    @abstractmethod
    def create(self, *, tenant_id: uuid.UUID, data: PortalPageCreate) -> PortalPageRead: ...

    @abstractmethod
    def get(self, *, tenant_id: uuid.UUID, page_id: uuid.UUID) -> PortalPageRead: ...

    @abstractmethod
    def list(self, *, tenant_id: uuid.UUID, page: int, page_size: int) -> Page[PortalPageRead]: ...

    @abstractmethod
    def update(self, *, tenant_id: uuid.UUID, page_id: uuid.UUID, data: PortalPageUpdate) -> PortalPageRead: ...

    @abstractmethod
    def delete(self, *, tenant_id: uuid.UUID, page_id: uuid.UUID) -> None: ...

    @abstractmethod
    def publish(self, *, tenant_id: uuid.UUID, page_id: uuid.UUID, published: bool) -> PortalPageRead: ...


class IAdsService(ABC):
    """Caso de uso de campañas publicitarias (CRUD + atribución UTM)."""

    @abstractmethod
    def create(self, *, tenant_id: uuid.UUID, data: AdCampaignCreate) -> AdCampaignRead: ...

    @abstractmethod
    def get(self, *, tenant_id: uuid.UUID, ad_campaign_id: uuid.UUID) -> AdCampaignRead: ...

    @abstractmethod
    def get_by_name(self, *, tenant_id: uuid.UUID, name: str) -> AdCampaignRead | None: ...

    @abstractmethod
    def list(
        self, *, tenant_id: uuid.UUID, page: int, page_size: int
    ) -> Page[AdCampaignRead]: ...

    @abstractmethod
    def update(
        self, *, tenant_id: uuid.UUID, ad_campaign_id: uuid.UUID, data: AdCampaignUpdate
    ) -> AdCampaignRead: ...

    @abstractmethod
    def delete(self, *, tenant_id: uuid.UUID, ad_campaign_id: uuid.UUID) -> None: ...


class ICrmService(ABC):
    """Caso de uso del subsistema CRM (pipeline, tareas, SLA y embudo).

    Contrato (PLAN_CRM_E2E_Y_UX §3.1): toda operación está acotada al
    ``tenant_id`` activo; mover un deal a una etapa terminal (``is_terminal``)
    cierra el deal según ``outcome`` (``won``/``lost``) y escribe un
    ``StageChangeRead`` en el historial append-only.
    """

    # Etapas del pipeline (M1)
    @abstractmethod
    def create_stage(self, *, tenant_id: uuid.UUID, data: StageCreate) -> StageRead: ...

    @abstractmethod
    def get_stage(self, *, tenant_id: uuid.UUID, stage_id: uuid.UUID) -> StageRead: ...

    @abstractmethod
    def list_stages(self, *, tenant_id: uuid.UUID) -> list[StageRead]: ...

    @abstractmethod
    def update_stage(
        self, *, tenant_id: uuid.UUID, stage_id: uuid.UUID, data: StageUpdate
    ) -> StageRead: ...

    @abstractmethod
    def delete_stage(self, *, tenant_id: uuid.UUID, stage_id: uuid.UUID) -> None: ...

    # Oportunidades (M1)
    @abstractmethod
    def create_deal(self, *, tenant_id: uuid.UUID, data: DealCreate) -> DealRead: ...

    @abstractmethod
    def get_deal(self, *, tenant_id: uuid.UUID, deal_id: uuid.UUID) -> DealRead: ...

    @abstractmethod
    def list_deals(
        self,
        *,
        tenant_id: uuid.UUID,
        page: int,
        page_size: int,
        stage_id: uuid.UUID | None = None,
        owner_id: uuid.UUID | None = None,
        status: str | None = None,
    ) -> Page[DealRead]: ...

    @abstractmethod
    def update_deal(
        self, *, tenant_id: uuid.UUID, deal_id: uuid.UUID, data: DealUpdate
    ) -> DealRead: ...

    @abstractmethod
    def delete_deal(self, *, tenant_id: uuid.UUID, deal_id: uuid.UUID) -> None: ...

    @abstractmethod
    def list_history(
        self, *, tenant_id: uuid.UUID, deal_id: uuid.UUID
    ) -> list[StageChangeRead]: ...

    # Tareas (M2)
    @abstractmethod
    def create_task(self, *, tenant_id: uuid.UUID, data: TaskCreate) -> TaskRead: ...

    @abstractmethod
    def get_task(self, *, tenant_id: uuid.UUID, task_id: uuid.UUID) -> TaskRead: ...

    @abstractmethod
    def list_tasks(
        self,
        *,
        tenant_id: uuid.UUID,
        page: int,
        page_size: int,
        deal_id: uuid.UUID | None = None,
    ) -> Page[TaskRead]: ...

    @abstractmethod
    def update_task(
        self, *, tenant_id: uuid.UUID, task_id: uuid.UUID, data: TaskUpdate
    ) -> TaskRead: ...

    @abstractmethod
    def delete_task(self, *, tenant_id: uuid.UUID, task_id: uuid.UUID) -> None: ...

    # SLA (M5)
    @abstractmethod
    def upsert_sla(self, *, tenant_id: uuid.UUID, data: SlaUpsert) -> SlaRead: ...

    @abstractmethod
    def list_sla(self, *, tenant_id: uuid.UUID) -> list[SlaRead]: ...

    # Reportes
    @abstractmethod
    def funnel(self, *, tenant_id: uuid.UUID) -> FunnelRead: ...

    @abstractmethod
    def summary(self, *, tenant_id: uuid.UUID, email: str) -> CrmSummaryRead: ...

    # Orquestación (P2): eventos consumidos por el subsistema CRM
    @abstractmethod
    def create_deal_from_lead(
        self,
        *,
        tenant_id: uuid.UUID,
        lead_id: uuid.UUID,
        name: str,
        email: str,
        phone: str | None,
        source: str,
        metadata: dict[str, Any],
    ) -> DealRead | None: ...

    @abstractmethod
    def suggest_won(
        self,
        *,
        tenant_id: uuid.UUID,
        customer_email: str,
        source: str,
    ) -> int: ...


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
    """Puerto de generación IA de landings y páginas de portal (DeepSeek) con caché."""

    @abstractmethod
    def generate_landing(
        self,
        *,
        tenant_id: uuid.UUID,
        prompt: str,
        workflow_type: str | None = None,
        brand_voice: dict[str, Any] | None = None,
    ) -> AiGenerationResult: ...

    @abstractmethod
    def generate_portal(
        self,
        *,
        tenant_id: uuid.UUID,
        prompt: str,
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

    ``serve`` recupera el HTML compilado de una versión concreta para el serving
    público (``GET /cdn/{landing_id}/v{version}``), siempre acotado al tenant.
    """

    @abstractmethod
    def deploy(self, *, tenant_id: uuid.UUID, landing_id: uuid.UUID) -> CdnDeployResponse: ...

    @abstractmethod
    def serve(
        self,
        *,
        tenant_id: uuid.UUID,
        landing_id: uuid.UUID,
        version: int,
        origin: str = "",
    ) -> str:
        """Devuelve el HTML compilado de la versión de una landing (serving CDN).

        Versión inexistente o de otro tenant → :class:`NotFoundError` (404).
        Si se provee ``origin``, se reescribe el ``apiBaseUrl`` del
        ``#omnibotia-config`` al origen del request (localhost, túnel o dominio).
        """
        ...


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


class IDnsVerifier(ABC):
    """Verificación de propiedad DNS de un dominio personalizado (TXT).

    Puerto para que dev/tests usen una implementación ``auto`` (sin dnspython)
    y producción use una consulta TXT real contra ``_omni2-verify.{host}``.
    """

    @abstractmethod
    def verify_txt(self, *, host: str, expected: str) -> bool:
        """Devuelve True si algún registro TXT de ``_omni2-verify.{host}``
        coincide con ``expected``."""
        ...


class IPseoHostService(ABC):
    """Caso de uso de dominios personalizados del tenant (CRUD + verificación).

    Ciclo de vida: ``request_domain`` (pending) → ``verify_domain`` (active,
    con ``verified_at``) → ``remove_domain`` (soft-delete). Solo los hosts
    ``active`` son servidos públicamente.
    """

    @abstractmethod
    def request_domain(self, *, tenant_id: uuid.UUID, host: str) -> PseoHostRead:
        """Registra un dominio en estado ``pending`` con su token de verificación."""
        ...

    @abstractmethod
    def list_domains(self, *, tenant_id: uuid.UUID) -> list[PseoHostRead]:
        """Lista los dominios del tenant (sin eliminados)."""
        ...

    @abstractmethod
    def verify_domain(
        self, *, tenant_id: uuid.UUID, host_id: uuid.UUID
    ) -> PseoHostRead:
        """Verifica la propiedad DNS y activa el dominio (idempotente)."""
        ...

    @abstractmethod
    def remove_domain(self, *, tenant_id: uuid.UUID, host_id: uuid.UUID) -> None:
        """Elimina (soft-delete) un dominio del tenant."""
        ...


class IRebrandingService(ABC):
    """Caso de uso de rebranding por URL (Fase 5).

    Descarga la página de una marca, extrae su paleta, tipografías y logo con
    BeautifulSoup y devuelve una :class:`AppearanceProposal` compatible con
    ``TenantAppearanceUpsert`` para que el frontend pueda aplicarla al tenant
    con un solo clic. La extracción es síncrona y acotada por tiempo.
    """

    @abstractmethod
    def extract_url_styles(self, *, url: str) -> AppearanceProposal:
        """Analiza ``url`` y propone estilos (paleta, tipografías y logo)."""
        ...


class IAuthService(ABC):
    """Caso de uso de autenticación de usuarios del estudio + RBAC.

    Responsabilidades:
    - Hash/verificación de contraseñas (bcrypt).
    - Emisión/validación de tokens JWT de acceso (stateless, sin refresh).
    - ``login`` verifica credenciales y registra ``last_login_at``.
    - ``change_password`` valida la contraseña actual antes de cambiarla.
    - ``decode_token`` devuelve el ``user_id`` contenido en un JWT válido.
    """

    @abstractmethod
    def hash_password(self, password: str) -> str:
        """Devuelve el hash bcrypt de ``password``."""
        ...

    @abstractmethod
    def verify_password(self, password: str, password_hash: str) -> bool:
        """Comprueba ``password`` contra un hash bcrypt."""
        ...

    @abstractmethod
    def create_access_token(self, *, user_id: uuid.UUID) -> str:
        """Emite un JWT de acceso firmado con el secreto configurado."""
        ...

    @abstractmethod
    def decode_token(self, token: str) -> uuid.UUID:
        """Valida un JWT y devuelve el ``user_id``; lanza si es inválido/expirado."""
        ...

    @abstractmethod
    def login(self, *, email: str, password: str) -> User:
        """Autentica un usuario activo por email+password.

        Lanza :class:`UnauthorizedError` si las credenciales son inválidas o el
        usuario está inactivo. Actualiza ``last_login_at`` en caso de éxito.
        """
        ...

    @abstractmethod
    def change_password(
        self, *, user_id: uuid.UUID, current_password: str, new_password: str
    ) -> None:
        """Cambia la contraseña de un usuario autenticado.

        Valida ``current_password`` y la longitud mínima de ``new_password``.
        """
        ...
