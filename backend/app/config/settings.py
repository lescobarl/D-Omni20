"""Configuración centralizada del backend.

Toda configuración proviene de variables de entorno / archivos ``.env``
(pydantic-settings). Prohibido valores quemados en código (regla CLAUDE #1).
"""

from __future__ import annotations

from functools import lru_cache
from typing import Annotated, Literal

from pydantic import Field, field_validator
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

    @property
    def is_production(self) -> bool:
        """True cuando el entorno es producción."""
        return self.backend_env == "production"


@lru_cache
def get_settings() -> Settings:
    """Carga única de configuración (fail-fast) — solo desde el composition root."""
    return Settings()
