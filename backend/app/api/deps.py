"""Composition root de la capa HTTP (FastAPI ``Depends``) — regla CLAUDE: DI.

Contrato:
- ``get_container`` / ``get_session`` exponen la infraestructura compuesta.
- Los *providers* construyen los puertos (repositorios/servicios ABC) con sus
  dependencias inyectadas; la lógica de negocio nunca instancia con ``new``.
- ``get_current_tenant`` resuelve y valida el tenant activo (UUID o slug vía la
  cabecera ``X-Tenant-Id``), lo fija en el ``RequestContext`` y aplica el GUC
  ``app.current_tenant_id`` para que RLS lo evalúe (defensa en profundidad).
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator

from fastapi import Depends, Header, Request
from sqlalchemy.orm import Session

from app.core.di import Container, build_container
from app.core.errors import TenantIsolationError
from app.core.tenancy import RequestContext, set_app_current_tenant
from app.repositories.interfaces import (
    IAuditRepository,
    ILandingRepository,
    ITenantRepository,
)
from app.repositories.sqlalchemy_repositories import (
    SqlAlchemyAuditRepository,
    SqlAlchemyLandingRepository,
    SqlAlchemyTenantRepository,
)
from app.services.audit_service import AuditService
from app.services.compiler_service import JinjaCompilerService
from app.services.interfaces import (
    IAuditService,
    ICompilerService,
    ILandingService,
)
from app.services.landing_service import LandingService


def get_container(request: Request) -> Container:
    """Devuelve el contenedor DI del arranque (fail-fast si no existe)."""
    container = getattr(request.app.state, "container", None)
    if container is None:
        container = build_container()
        request.app.state.container = container
    return container


def get_session(request: Request) -> Iterator[Session]:
    """Abre la sesión del request (el evento ``after_begin`` aplica el GUC)."""
    container = get_container(request)
    with container.database.session_scope() as session:
        yield session


def get_tenant_repository(session: Session = Depends(get_session)) -> ITenantRepository:
    return SqlAlchemyTenantRepository(session)


def get_landing_repository(session: Session = Depends(get_session)) -> ILandingRepository:
    return SqlAlchemyLandingRepository(session)


def get_audit_repository(session: Session = Depends(get_session)) -> IAuditRepository:
    return SqlAlchemyAuditRepository(session)


def get_audit_service(
    repository: IAuditRepository = Depends(get_audit_repository),
    container: Container = Depends(get_container),
) -> IAuditService:
    return AuditService(repository=repository, logger=container.logger)


def get_compiler_service() -> ICompilerService:
    return JinjaCompilerService()


def get_landing_service(
    repository: ILandingRepository = Depends(get_landing_repository),
    audit: IAuditService = Depends(get_audit_service),
    compiler: ICompilerService = Depends(get_compiler_service),
    container: Container = Depends(get_container),
) -> ILandingService:
    return LandingService(
        repository=repository,
        audit=audit,
        compiler=compiler,
        logger=container.logger,
    )


def get_current_tenant(
    request: Request,
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
    session: Session = Depends(get_session),
    tenant_repository: ITenantRepository = Depends(get_tenant_repository),
) -> uuid.UUID:
    """Resuelve y fija el tenant activo del request (UUID o slug).

    - Cabecera ausente → :class:`TenantIsolationError` (403).
    - UUID válido → se usa directamente.
    - Slug → se resuelve contra la tabla ``tenants`` (404 si no existe).
    - Se fija en ``RequestContext`` y como GUC para RLS en PostgreSQL.
    """
    if not x_tenant_id or not x_tenant_id.strip():
        raise TenantIsolationError(
            "La cabecera X-Tenant-Id es requerida",
            operation="tenant.resolve",
            context={"header": "X-Tenant-Id"},
        )

    try:
        tenant_id = uuid.UUID(x_tenant_id.strip())
    except (ValueError, AttributeError):
        tenant = tenant_repository.get_by_slug(x_tenant_id.strip())
        if tenant is None:
            raise TenantIsolationError(
                "Tenant no encontrado para el slug indicado",
                operation="tenant.resolve",
                context={"x_tenant_id": x_tenant_id},
            ) from None
        tenant_id = tenant.id

    tenant_id_str = str(tenant_id)
    # Comunica el tenant resuelto a la auditoría exterior vía request.state: el
    # contextvar no atraviesa los hilos de los sync deps/endpoints (se pierde el
    # set), mientras que request.state es un State compartido por scope.
    request.state.tenant_id = tenant_id
    RequestContext.set_tenant(tenant_id_str)
    # Aplica el GUC a la transacción ya abierta (RLS de PostgreSQL).
    set_app_current_tenant(session.connection(), tenant_id_str)
    return tenant_id
