"""Pruebas de la configuración centralizada (pydantic-settings, fail-fast)."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.config.settings import Settings, get_settings


def test_settings_accepts_explicit_values() -> None:
    settings = Settings(
        database_url="postgresql://usuario:pass@localhost:5432/db",
        backend_env="production",
        cors_origins=["http://a.example.com", "http://b.example.com"],
        log_level="warning",
        token_encryption_key="0123456789abcdef0123456789abcdef",
    )
    assert settings.database_url == "postgresql://usuario:pass@localhost:5432/db"
    assert settings.backend_env == "production"
    assert settings.cors_origins == ["http://a.example.com", "http://b.example.com"]
    assert settings.log_level == "WARNING"
    assert settings.is_production is True
    assert settings.token_encryption_key == "0123456789abcdef0123456789abcdef"


def test_settings_production_requires_token_encryption_key() -> None:
    # Fase 3: en producción la persistencia cifrada de tokens OAuth exige la
    # clave; sin ella el arranque debe fallar (fail-fast).
    with pytest.raises(ValidationError):
        Settings(
            database_url="postgresql://usuario:pass@localhost:5432/db",
            backend_env="production",
            _env_file=None,
        )


def test_settings_accepts_token_encryption_key_in_production() -> None:
    settings = Settings(
        database_url="postgresql://usuario:pass@localhost:5432/db",
        backend_env="production",
        token_encryption_key="fedcba9876543210fedcba9876543210",
        _env_file=None,
    )
    assert settings.is_production is True
    assert settings.token_encryption_key == "fedcba9876543210fedcba9876543210"


def test_settings_requires_database_url() -> None:
    with pytest.raises(ValidationError):
        Settings(database_url="")


def test_settings_splits_cors_origins_csv() -> None:
    settings = Settings(
        database_url="sqlite:///x.db",
        cors_origins="http://a.example.com, http://b.example.com ,",
    )
    assert settings.cors_origins == ["http://a.example.com", "http://b.example.com"]


def test_settings_rejects_invalid_log_level() -> None:
    with pytest.raises(ValidationError):
        Settings(database_url="sqlite:///x.db", log_level="verbose")


def test_settings_defaults() -> None:
    # ``_env_file=None`` aísla la prueba del ``.env`` real (p.ej. donde
    # ``AUTO_CREATE_TABLES=true``) para validar los defaults del modelo.
    settings = Settings(database_url="sqlite:///x.db", _env_file=None)
    assert settings.app_name == "OmniBotIA Studio API"
    assert settings.app_version == "0.2.0"
    assert settings.backend_env == "development"
    assert settings.api_v1_prefix == "/api/v1"
    assert settings.auto_create_tables is False
    assert settings.is_production is False


def test_settings_default_cors_origins() -> None:
    settings = Settings(database_url="sqlite:///x.db")
    assert settings.cors_origins == ["http://localhost:5173"]


def test_get_settings_is_cached() -> None:
    assert get_settings() is get_settings()
