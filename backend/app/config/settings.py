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
    redis_url: str = "redis://localhost:6379/0"

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
    dev_tenant_slug: str = "dev-tenant"
    dev_tenant_name: str = "Tenant de Desarrollo"

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
    # Google Calendar OAuth 2.0 (opcional; vacío = solo calendario ICS local).
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:8000/api/v1/auth/google/callback"
    google_timeout_seconds: float = 30.0
    # Cifrado de tokens OAuth en reposo (Fase 3 — obligatorio solo en producción).
    token_encryption_key: str = ""
    # Recordatorios de citas (scheduler de la stdlib — Fase 1 del backlog).
    appointment_reminder_hours: int = Field(default=24, ge=1, le=168)
    reminder_poll_interval_seconds: float = Field(default=60.0, gt=0)
    reminder_enabled: bool = True

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

    @property
    def is_production(self) -> bool:
        """True cuando el entorno es producción."""
        return self.backend_env == "production"


@lru_cache
def get_settings() -> Settings:
    """Carga única de configuración (fail-fast) — solo desde el composition root."""
    return Settings()
