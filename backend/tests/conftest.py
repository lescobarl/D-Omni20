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
        # Artefactos (PDF/ICS) a un directorio temporal para no ensuciar el repo.
        workflow_artifacts_dir=str(data_dir / "artifacts"),
        # El scheduler de recordatorios NO debe arrancar en tests (se invoca a mano).
        reminder_enabled=False,
        # Secreto del Portal del Cliente (C-3): valor explícito de test (la app
        # solo lo lee de Settings; nunca se hardcodea en el código de negocio).
        portal_token_secret="test-portal-secret",
        # Secreto JWT determinista para firmar/verificar tokens de acceso del
        # estudio (Auth + RBAC). En desarrollo no se valida, pero los tests
        # necesitan un valor estable para emitir y validar tokens.
        jwt_secret="test-jwt-secret",
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


# ────────────────────────────────────────────────────────────────────────────
# Helpers de autenticación del estudio (Auth + RBAC)
# ────────────────────────────────────────────────────────────────────────────
# Los tests de auth/RBAC necesitan crear usuarios/membresías y obtener tokens
# Bearer. Se siembran a nivel repositorio (mismo archivo SQLite compartido entre
# el contenedor del conftest y la app del cliente) y se autentican vía HTTP.

from app.models.user import Role  # noqa: E402
from app.repositories.sqlalchemy_repositories import (  # noqa: E402
    SqlAlchemyMembershipRepository,
    SqlAlchemyUserRepository,
)
from app.services.auth_service import AuthService  # noqa: E402


def _seed_user(
    container: Container,
    *,
    email: str,
    password: str = "Password123!",
    display_name: str | None = None,
    is_super_admin: bool = False,
    is_active: bool = True,
) -> uuid.UUID:
    """Crea un usuario a nivel repositorio y devuelve su UUID (idempotente por email)."""
    with container.database.session_scope() as session:
        repo = SqlAlchemyUserRepository(session)
        existing = repo.get_by_email(email)
        if existing is not None:
            return existing.id
        auth = AuthService(
            user_repository=repo,
            settings=container.settings,
            logger=container.logger,
        )
        user = repo.create(
            email=email,
            password_hash=auth.hash_password(password),
            display_name=display_name,
            is_super_admin=is_super_admin,
            is_active=is_active,
        )
        session.commit()
        return user.id


def _seed_membership(
    container: Container,
    *,
    user_id: uuid.UUID,
    tenant_id: uuid.UUID,
    role: Role,
) -> None:
    """Añade una membresía usuario↔tenant a nivel repositorio (idempotente)."""
    with container.database.session_scope() as session:
        repo = SqlAlchemyMembershipRepository(session)
        existing = repo.get_by_user_and_tenant(user_id=user_id, tenant_id=tenant_id)
        if existing is not None:
            return
        repo.create(user_id=user_id, tenant_id=tenant_id, role=role)
        session.commit()


def _login_token(client: TestClient, email: str, password: str = "Password123!") -> str:
    """Autentica vía HTTP y devuelve el Bearer token de acceso."""
    response = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
    )
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def _auth_headers(token: str) -> dict[str, str]:
    """Cabeceras de autenticación Bearer para un token dado."""
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="session")
def super_admin_token(
    container: Container, client: TestClient
) -> str:
    """Token Bearer de un super-admin de plataforma (control-plane)."""
    user_id = _seed_user(
        container,
        email="superadmin@test.local",
        display_name="Super Admin",
        is_super_admin=True,
    )
    return _login_token(client, "superadmin@test.local")


@pytest.fixture(scope="session")
def tenant_admin_token(
    container: Container, client: TestClient, tenant_id: uuid.UUID
) -> str:
    """Token Bearer de un admin del tenant de desarrollo."""
    user_id = _seed_user(
        container,
        email="tenantadmin@test.local",
        display_name="Tenant Admin",
    )
    _seed_membership(
        container, user_id=user_id, tenant_id=tenant_id, role=Role.ADMIN
    )
    return _login_token(client, "tenantadmin@test.local")


@pytest.fixture(scope="session")
def configurador_token(
    container: Container, client: TestClient, tenant_id: uuid.UUID
) -> str:
    """Token Bearer de un configurador del tenant de desarrollo."""
    user_id = _seed_user(
        container,
        email="configurador@test.local",
        display_name="Configurador",
    )
    _seed_membership(
        container, user_id=user_id, tenant_id=tenant_id, role=Role.CONFIGURADOR
    )
    return _login_token(client, "configurador@test.local")


@pytest.fixture(scope="session")
def operador_token(
    container: Container, client: TestClient, tenant_id: uuid.UUID
) -> str:
    """Token Bearer de un operador del tenant de desarrollo."""
    user_id = _seed_user(
        container,
        email="operador@test.local",
        display_name="Operador",
    )
    _seed_membership(
        container, user_id=user_id, tenant_id=tenant_id, role=Role.OPERADOR
    )
    return _login_token(client, "operador@test.local")


@pytest.fixture(scope="session")
def non_member_token(container: Container, client: TestClient) -> str:
    """Token Bearer de un usuario activo SIN membresía en ningún tenant."""
    _seed_user(
        container,
        email="nonmember@test.local",
        display_name="Sin Membresía",
    )
    return _login_token(client, "nonmember@test.local")
