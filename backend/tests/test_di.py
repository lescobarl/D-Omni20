"""Pruebas del contenedor de dependencias (regla CLAUDE: DI, sin ``new``)."""

from __future__ import annotations

from app.core.di import build_container
from app.core.logging import ILogger
from app.core.rls import RLSManager


def test_build_container_exposes_singletons(test_settings) -> None:
    container = build_container(test_settings)

    assert isinstance(container.logger, ILogger)
    assert container.database is not None
    assert isinstance(container.rls, RLSManager)
    assert container.settings is test_settings

    container.dispose()


def test_container_properties_are_lazy_singletons(test_settings) -> None:
    container = build_container(test_settings)
    assert container.logger is container.logger
    assert container.database is container.database
    assert container.rls is container.rls
    container.dispose()


def test_container_database_url_matches_settings(test_settings) -> None:
    container = build_container(test_settings)
    url = str(container.database.engine.url)
    assert "sqlite" in url
    assert "test.db" in url
    container.dispose()


def test_build_container_without_settings_uses_defaults() -> None:
    container = build_container()
    assert container.settings is not None
    container.dispose()
