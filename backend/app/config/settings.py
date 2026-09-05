"""Configuración centralizada del backend.

Toda configuración proviene de variables de entorno / archivos ``.env``
(pydantic-settings). Prohibido valores quemados en código (regla CLAUDE #1).
"""

from __future__ import annotations

import json
from functools import lru_cache
from typing import Annotated, Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

BackendEnv = Literal["development", "staging", "production"]

_LOG_LEVELS = frozenset({"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"})


class Settings(BaseSettings):
    """Configuración validada del backend.

    Contrato: carga desde variables de entorno (prefijo libre) y archivos
    ``.env`` / ``.env.local``. Lanza :class:`ValidationError` al arranque si
    una variable requerida falta o es inválida (fail-fast, sin valores
    silenciosos).
    """

    model_config = SettingsConfigDict(
        env_file=(".env", ".env.local"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Aplicación ────────────────────────────────────────────────────────
    app_name: str = "OmniBotIA Studio API"
    app_version: str = "0.2.0"
    backend_env: BackendEnv = "development"
    api_v1_prefix: str = "/api/v1"

    # ── Base de datos ──────────────────────────────────────────────────────
    database_url: str = Field(..., min_length=1, description="URL de conexión (PostgreSQL en prod; SQLite en dev/tests)")
    redis_url: str = "redis://127.0.0.1:6379/0"
    # Timeouts del cliente Redis (cola D3). El cliente es fail-closed: cuando
    # Redis no está disponible cada operación devuelve un valor por defecto en
    # lugar de propagar el error. Sin timeouts, redis-py bloquea demasiado en
    # cada llamada (reintentos/backoff por defecto) y la latencia de los
    # endpoints de estadísticas degenera (medido: 12.2s para 3 llamadas).
    # ``socket_connect_timeout`` acota el establecimiento de conexión y
    # ``socket_timeout`` cada operación de socket (configurables, sin hardcode).
    # Por defecto se usa 127.0.0.1 y no "localhost": al resolver "localhost" el
    # stack intenta primero IPv6 (::1), cuyo SYN se pierde (blackhole) hasta
    # agotar el connect timeout y luego reintenta IPv4 — cada llamada cuesta
    # 2× el connect timeout. Con 127.0.0.1 cada llamada cuesta 1× (verificado).
    redis_connect_timeout_seconds: float = Field(default=0.3, gt=0)
    redis_operation_timeout_seconds: float = Field(default=1.0, gt=0)

    # ── IA (DeepSeek) - solo backend ───────────────────────────────────────
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com/v1"
    deepseek_model: str = "deepseek-chat"
    deepseek_timeout_seconds: float = 30.0
    deepseek_max_tokens: int = 2000
    deepseek_temperature: float = 0.7
    deepseek_cache_ttl_seconds: float = 3600.0
    ai_cache_max_entries: int = 512

    # ── CORS ───────────────────────────────────────────────────────────────
    # NoDecode: evita que pydantic-settings intente parsear como JSON el valor
    # de la variable de entorno; el validator ``_split_cors_origins`` recibe el
    # texto crudo separado por comas.
    cors_origins: Annotated[list[str], NoDecode] = Field(default_factory=lambda: ["http://localhost:5173"])

    # ── Logging estructurado + auditoría ───────────────────────────────────
    log_level: str = "INFO"
    log_dir: str = "logs"
    log_max_bytes: int = 10_485_760  # 10 MB
    log_backup_count: int = 5
    audit_log_path: str = "logs/audit.jsonl"

    # ── Conveniencia de desarrollo local ───────────────────────────────────
    auto_create_tables: bool = False
    # Slug/nombre del tenant de desarrollo auto-creado al arrancar. Sin default
    # en código (regla CLAUDE #1): deben venir de ``.env`` (DEV_TENANT_SLUG /
    # DEV_TENANT_NAME). ``None`` = no sembrar tenant dev (p. ej. en entornos
    # donde no se configura; producción lo ignora igualmente vía is_production).
    dev_tenant_slug: str | None = None
    dev_tenant_name: str | None = None

    # ── Workflows (checkout, leads, cotizaciones, citas) ───────────────────
    # Pasarela: "sandbox" (determinista, sin credenciales) | "live" (Stripe).
    payment_mode: Literal["sandbox", "live"] = "sandbox"
    workflow_checkout_base_url: str = "http://localhost:8000/workflows/sandbox/"
    workflow_artifacts_dir: str = "artifacts"
    workflow_artifacts_base_url: str = "http://localhost:8000/artifacts"

    # ── CDN (Fase 10 — despliegue de landings) ─────────────────────────────
    # URL base de la que el CDN sirve las landings versionadas:
    # ``{cdn_base_url}/{landing_id}/v{version}``.
    cdn_base_url: str = "http://localhost:8000/cdn"
    # Dominio base de los subdominios dinámicos de clientes sin dominio propio
    # (C-3 Portales multired): ``{slug}.clientes.omni2.app`` vía Wildcard DNS
    # (CNAME/A → nuestro servidor). El navegador envía el subdominio en la
    # cabecera ``Host`` y ``get_pseo_tenant_by_host`` lo resuelve al tenant,
    # igual que un dominio personalizado. Se usa también para derivar el origen
    # CORS ``*.clientes.omni2.app``. Vacío = subdominios desactivados.
    client_subdomain_base: str = "clientes.omni2.app"
    # Verificación DNS de dominios personalizados: "auto" (auto-verifica en
    # dev/tests sin dnspython) | "dns" (consulta TXT real vía dnspython).
    dns_verify_mode: Literal["auto", "dns"] = "auto"
    # Stripe (solo cuando payment_mode="live"; vacíos = ConfigValidationError).
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    stripe_checkout_success_url: str = "http://localhost:5173/checkout/success"
    stripe_checkout_cancel_url: str = "http://localhost:5173/checkout/cancel"
    stripe_timeout_seconds: float = 30.0
    # CRM externo (webhook opcional; vacío = no notificar y devolver False).
    # ``crm_provider`` selecciona el adaptador: "generic" (payload plano),
    # "hubspot" (envelope {"properties": ...}), "salesforce" (sObject plano) o
    # "zoho" (envelope {"data": [...]}). ``crm_field_mapping_json`` renombra/
    # anida campos destino (ej. '{"campaign": "properties.campaign_origin"}');
    # vacío = passthrough identidad.
    crm_webhook_url: str = ""
    crm_webhook_timeout_seconds: float = 5.0
    crm_provider: str = "generic"
    crm_field_mapping_json: str = ""
    crm_retry_max_attempts: int = Field(default=3, ge=1, le=10)
    crm_retry_backoff_seconds: float = Field(default=0.5, ge=0.0)
    # Endpoints y tokens opcionales por proveedor (si vacío, cada adaptador
    # cae al ``crm_webhook_url`` genérico; token vacío = sin header Bearer).
    crm_hubspot_url: str = ""
    crm_hubspot_token: str = ""
    crm_salesforce_url: str = ""
    crm_salesforce_token: str = ""
    crm_zoho_url: str = ""
    crm_zoho_token: str = ""
    # Correo SMTP (opcional; vacío = no enviar y devolver False).
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from_email: str = ""
    smtp_use_tls: bool = True
    smtp_timeout_seconds: float = 10.0
    # Directorio de plantillas Jinja2 de email (relativo al CWD del backend).
    email_templates_dir: str = "email_templates"
    # SMS Twilio (opcional; vacío = no enviar y devolver False).
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_phone_number: str = ""
    twilio_timeout_seconds: float = 10.0
    # WhatsApp Cloud API (Meta) (opcional; vacío = no enviar y devolver False).
    whatsapp_phone_number_id: str = ""
    whatsapp_access_token: str = ""
    whatsapp_webhook_secret: str = ""
    whatsapp_timeout_seconds: float = 10.0
    # URL base de la WhatsApp Cloud API (Meta); configurable para pruebas e2e
    # locales (mock) sin cambiar el valor de producción por defecto.
    whatsapp_base_url: str = "https://graph.facebook.com/v21.0"
    # Graph API de Meta para mensajería (Instagram/Messenger; opcional).
    meta_graph_timeout_seconds: float = 10.0
    # URL base de la Graph API de Meta; configurable para pruebas e2e locales
    # (mock) sin cambiar el valor de producción por defecto.
    meta_graph_base_url: str = "https://graph.facebook.com/v21.0"
    # Google Calendar OAuth 2.0 (opcional; vacío = solo calendario ICS local).
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:8000/api/v1/auth/google/callback"
    google_timeout_seconds: float = 30.0
    # Cifrado de tokens OAuth en reposo (Fase 3 — obligatorio solo en producción).
    token_encryption_key: str = ""
    # Secreto HMAC de los tokens del Portal del Cliente (C-3). Se firma el
    # payload ``{tenant_id, email, exp}``; obligatorio solo en producción.
    portal_token_secret: str = ""
    # Recordatorios de citas (scheduler de la stdlib — Fase 1 del backlog).
    appointment_reminder_hours: int = Field(default=24, ge=1, le=168)
    reminder_poll_interval_seconds: float = Field(default=60.0, gt=0)
    reminder_enabled: bool = True
    # Dispatcher de campañas de recompra/postventa/recuperación (C-2).
    # OFF por defecto (fail-closed; se habilita en prod como bot_worker_enabled).
    campaign_dispatcher_enabled: bool = False
    campaign_poll_interval_seconds: float = Field(default=60.0, gt=0)

    # ── Bot OmniBotIA (Fase 3) ─────────────────────────────────────────────
    # URL base de la API de OmniBotIA y credencial m2m del bot para resolver el
    # context bundle (``GET /api/v1/bot/context/{channel_id}``).
    omni2_api_base_url: str = "http://localhost:8000"
    omni2_service_credential: str = ""
    # Activa/desactiva el subsistema bot de forma central (no elimina datos).
    bot_feature_enabled: bool = True
    # Timeout del cliente HTTP del context bundle (segundos).
    bot_context_timeout_seconds: float = Field(default=10.0, gt=0)
    # Prefijo de los Streams de Redis para la cola de mensajes (Fase 5.1).
    bot_queue_stream_prefix: str = "bot:queue"
    # Grupo de workers del procesador asíncrono (Fase 5.1).
    bot_worker_group: str = "bot-workers"
    # Prefijo de los DLQ por tenant (D3: fallos de procesamiento).
    bot_queue_dlq_prefix: str = "bot:dlq"
    # Límite de longitud por stream (``XTRIM MAXLEN``) para acotar memoria.
    bot_queue_maxlen: int = Field(default=10_000, ge=100, le=1_000_000)
    # Tamaño de lote por lectura del worker (``XREADGROUP COUNT``).
    bot_queue_batch_size: int = Field(default=10, ge=1, le=100)
    # Idle mínimo para reclamar entradas abandonadas del PEL (``XCLAIM``).
    bot_queue_claim_timeout_seconds: float = Field(default=60.0, gt=0)
    # Ventana de deduplicación por ``message_id`` (reintentos/reenvíos, seg).
    bot_queue_dedupe_window_seconds: float = Field(default=300.0, ge=0)
    # Worker pool en proceso: OFF por defecto (fail-closed; se habilita en prod).
    bot_worker_enabled: bool = False
    # Tamaño del pool de hilos del worker (consumidores por tenant).
    bot_worker_pool_size: int = Field(default=2, ge=1, le=16)
    # Intervalo de polling del worker cuando no hay mensajes (seg).
    bot_worker_poll_interval_seconds: float = Field(default=1.0, gt=0)
    # Reintentos máximos por mensaje antes de moverlo al DLQ (reintento acotado).
    bot_queue_max_attempts: int = Field(default=3, ge=1, le=10)
    # Base URL de la API compatible OpenAI para el router de proveedores (Fase 6).
    bot_llm_base_url: str = "https://openrouter.ai/api/v1"
    # Timeout de la llamada LLM del router (segundos, defensa en profundidad).
    bot_llm_timeout_seconds: float = Field(default=30.0, gt=0)
    # Modelo por defecto cuando la empresa no fija uno propio (no hardcode en DI).
    bot_llm_default_model: str = "openrouter/auto"
    # TTL de la caché de respuestas LLM del router (0 = sin caché).
    bot_llm_cache_ttl_seconds: float = Field(default=3600.0, ge=0)
    # Retención de datos del bot por tenant en días (M4 LFPDPPP, Fase 9a).
    # 0 = sin borrado automático (el tenant conserva sus datos indefinidamente).
    bot_data_retention_days: int = Field(default=180, ge=0)
    # Cuota diaria de tokens consumidos por el bot por tenant (L1, Fase 9b).
    # 0 = sin límite (solo reporte de consumo, sin bloquear).
    bot_quota_daily_tokens: int = Field(default=100_000, ge=0)
    # Ventana de la cuota en horas (por defecto 24 h = cuota diaria).
    bot_quota_window_hours: float = Field(default=24.0, ge=1)
    # Timeout del cliente HTTP de extracción de estilos por URL (Fase 5
    # rebranding). Configurable, nunca ``None`` (regla CLAUDE: timeout explícito).
    bot_rebranding_timeout_seconds: float = Field(default=15.0, gt=0)

    # ── Autenticación de usuarios del estudio + RBAC ────────────────────────
    # Secreto de firma de los tokens JWT de acceso de los usuarios del estudio.
    # Obligatorio en producción (fail-fast, ver ``_validate_jwt_secret``).
    jwt_secret: str = ""
    # Algoritmo de firma JWT (HS256 por defecto).
    jwt_algorithm: str = "HS256"
    # TTL de los tokens de acceso en minutos (sin refresh tokens en esta fase).
    jwt_access_token_ttl_minutes: int = Field(default=60, ge=1, le=1440)
    # Longitud mínima de la contraseña de los usuarios del estudio.
    password_min_length: int = Field(default=8, ge=6, le=128)

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_cors_origins(cls, value: object) -> object:
        """Acepta ``CORS_ORIGINS=http://a,http://b`` (texto separado por comas)."""
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @field_validator("log_level")
    @classmethod
    def _validate_log_level(cls, value: str) -> str:
        normalized = value.upper()
        if normalized not in _LOG_LEVELS:
            raise ValueError(f"LOG_LEVEL inválido: {value!r}. Permitidos: {sorted(_LOG_LEVELS)}")
        return normalized

    @field_validator("crm_provider")
    @classmethod
    def _validate_crm_provider(cls, value: str) -> str:
        normalized = value.strip().lower()
        allowed = frozenset({"generic", "hubspot", "salesforce", "zoho"})
        if normalized not in allowed:
            raise ValueError(
                f"CRM_PROVIDER inválido: {value!r}. Permitidos: {sorted(allowed)}"
            )
        return normalized

    @field_validator("crm_field_mapping_json")
    @classmethod
    def _validate_crm_field_mapping_json(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            return ""
        try:
            parsed = json.loads(stripped)
        except json.JSONDecodeError as exc:
            raise ValueError(f"CRM_FIELD_MAPPING_JSON no es JSON válido: {exc}") from exc
        if not isinstance(parsed, dict) or not all(
            isinstance(k, str) and isinstance(v, str) for k, v in parsed.items()
        ):
            raise ValueError(
                "CRM_FIELD_MAPPING_JSON debe ser un objeto JSON de string → string "
                '(ej. \'{"campaign": "properties.campaign_origin"}\')'
            )
        return stripped

    @model_validator(mode="after")
    def _validate_token_encryption_key(self) -> "Settings":
        """Fail-fast: en producción la clave de cifrado de tokens es obligatoria."""
        if self.is_production and not self.token_encryption_key:
            raise ValueError(
                "TOKEN_ENCRYPTION_KEY es obligatorio en producción (cifrado de "
                "tokens OAuth en reposo, Fase 3 del backlog)."
            )
        return self

    @model_validator(mode="after")
    def _validate_portal_token_secret(self) -> "Settings":
        """Fail-fast: en producción el secreto del Portal del Cliente es obligatorio."""
        if self.is_production and not self.portal_token_secret:
            raise ValueError(
                "PORTAL_TOKEN_SECRET es obligatorio en producción (firma HMAC de "
                "los tokens del Portal del Cliente, C-3)."
            )
        return self

    @model_validator(mode="after")
    def _validate_jwt_secret(self) -> "Settings":
        """Fail-fast: en producción el secreto JWT de los usuarios es obligatorio."""
        if self.is_production and not self.jwt_secret:
            raise ValueError(
                "JWT_SECRET es obligatorio en producción (firma de los tokens de "
                "acceso de los usuarios del estudio, Auth + RBAC)."
            )
        return self

    @property
    def is_production(self) -> bool:
        """True cuando el entorno es producción."""
        return self.backend_env == "production"


@lru_cache
def get_settings() -> Settings:
    """Carga única de configuración (fail-fast) — solo desde el composition root."""
    return Settings()
