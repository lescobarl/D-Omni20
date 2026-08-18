"""Fixtures compartidos para la suite de tests del backend.

Notas de diseño:
- Se usa un SQLite **en archivo temporal** (no ``:memory:``) porque cada
  instancia de :class:`Database` crea su propio ``StaticPool`` aislado; el
  contenedor del conftest y el contenedor interno de ``create_app`` deben
  compartir el mismo archivo para ver los mismos datos.
- En Windows la URL se normaliza con ``.as_posix()`` para evitar barras
  invertidas inválidas en la URL.
- El contexto de correlación (``RequestContext``) usa ``contextvars`` y se
  filtra entre tests con una fixture autouse.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from app.config.settings import Settings
from app.core.di import Container, build_container
from app.core.tenancy import RequestContext
from app.main import create_app
from app.models.base import Base
from app.repositories.sqlalchemy_repositories import SqlAlchemyTenantRepository


@pytest.fixture(scope="session")
def test_settings(tmp_path_factory) -> Settings:
    """Settings aislados: SQLite en archivo temporal (compartido entre contenedores)."""
    data_dir = tmp_path_factory.mktemp("data")
    return Settings(
        database_url=f"sqlite:///{(data_dir / 'test.db').as_posix()}",
        auto_create_tables=True,
        dev_tenant_slug="dev-tenant",
        dev_tenant_name="Tenant de Desarrollo",
        log_dir=str(data_dir),
        audit_log_path=str(data_dir / "audit.jsonl"),
        cors_origins=["http://localhost:5173"],
        backend_env="development",
        log_level="DEBUG",
    )


@pytest.fixture(scope="session")
def container(test_settings) -> Container:
    """Contenedor DI compartido: tablas creadas + tenant de desarrollo sembrado."""
    container = build_container(test_settings)
    Base.metadata.create_all(container.database.engine)
    with container.database.session_scope() as session:
        repo = SqlAlchemyTenantRepository(session)
        if repo.get_by_slug(test_settings.dev_tenant_slug) is None:
            repo.create(slug=test_settings.dev_tenant_slug, name=test_settings.dev_tenant_name)
    yield container
    container.dispose()


@pytest.fixture(scope="session")
def client(test_settings) -> TestClient:
    """Cliente HTTP real contra la app (lifespan ejecutado con ``with``)."""
    app = create_app(test_settings)
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(scope="session")
def tenant_id(container, test_settings) -> uuid.UUID:
    """UUID del tenant de desarrollo sembrado."""
    with container.database.session_scope() as session:
        repo = SqlAlchemyTenantRepository(session)
        tenant = repo.get_by_slug(test_settings.dev_tenant_slug)
        assert tenant is not None
        return tenant.id


@pytest.fixture(scope="function")
def db_session(container):
    """Sesión transaccional por test contra el contenedor compartido."""
    with container.database.session_scope() as session:
        yield session


@pytest.fixture(autouse=True)
def _reset_request_context() -> None:
    """Aísla el contexto de correlación (contextvars) entre tests."""
    RequestContext.reset()
    yield
    RequestContext.reset()
