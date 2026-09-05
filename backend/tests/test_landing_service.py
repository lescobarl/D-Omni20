"""Pruebas del caso de uso de landings (servicio con puertos inyectados)."""

from __future__ import annotations

import uuid

import pytest

from app.core.errors import ConflictError, InputValidationError, NotFoundError
from app.core.tenancy import RequestContext
from app.repositories.sqlalchemy_repositories import (
    SqlAlchemyAuditRepository,
    SqlAlchemyCdnDeploymentRepository,
    SqlAlchemyLandingRepository,
    SqlAlchemyTenantRepository,
)
from app.schemas.landing import LandingCompileRequest, LandingCreate, LandingUpdate
from app.services.audit_service import AuditService
from app.services.cdn_deployment_service import CdnDeploymentService
from app.services.compiler_service import JinjaCompilerService
from app.services.landing_service import LandingService


@pytest.fixture()
def service(container, db_session, tenant_id) -> LandingService:
    """Servicio de landings con dependencias reales (repositorios + auditoría)."""
    RequestContext.new_request()
    RequestContext.set_tenant(str(tenant_id))
    audit = AuditService(
        repository=SqlAlchemyAuditRepository(db_session),
        logger=container.logger,
    )
    cdn = CdnDeploymentService(
        repository=SqlAlchemyCdnDeploymentRepository(db_session),
        landing_repository=SqlAlchemyLandingRepository(db_session),
        tenant_repository=SqlAlchemyTenantRepository(db_session),
        compiler=JinjaCompilerService(),
        settings=container.settings,
        audit=audit,
        logger=container.logger,
    )
    return LandingService(
        repository=SqlAlchemyLandingRepository(db_session),
        audit=audit,
        compiler=JinjaCompilerService(),
        cdn=cdn,
        logger=container.logger,
    )


def _create_payload(
    campaign_id: uuid.UUID | None = None,
    name: str = "Landing de prueba",
) -> LandingCreate:
    return LandingCreate(
        campaign_id=campaign_id or uuid.uuid4(),
        name=name,
        config={"title": "Prueba", "blocks": []},
    )


def test_create_and_get(service, tenant_id) -> None:
    created = service.create(tenant_id=tenant_id, data=_create_payload())
    assert created.id is not None
    assert created.tenant_id == tenant_id
    assert created.name == "Landing de prueba"
    assert created.slug == "landing-de-prueba"
    assert created.revision == 1
    assert created.published is False

    fetched = service.get(tenant_id=tenant_id, landing_id=created.id)
    assert fetched.id == created.id


def test_create_with_explicit_slug(service, tenant_id) -> None:
    payload = _create_payload(name="Landing con slug propio")
    payload.slug = "mi-landing-personalizada"
    created = service.create(tenant_id=tenant_id, data=payload)
    assert created.slug == "mi-landing-personalizada"


def test_create_duplicate_slug_raises_conflict(service, tenant_id) -> None:
    service.create(tenant_id=tenant_id, data=_create_payload(name="Landing duplicada"))
    with pytest.raises(ConflictError) as exc_info:
        service.create(tenant_id=tenant_id, data=_create_payload(name="Landing duplicada"))
    assert exc_info.value.operation == "landing.create"
    assert "URL amigable" in str(exc_info.value)


def test_create_duplicate_campaign_raises_conflict(service, tenant_id) -> None:
    campaign_id = uuid.uuid4()
    service.create(tenant_id=tenant_id, data=_create_payload(campaign_id, name="Landing campaña"))
    with pytest.raises(ConflictError) as exc_info:
        service.create(tenant_id=tenant_id, data=_create_payload(campaign_id, name="Landing campaña"))
    assert exc_info.value.operation == "landing.create"


def test_get_missing_raises_not_found(service, tenant_id) -> None:
    with pytest.raises(NotFoundError):
        service.get(tenant_id=tenant_id, landing_id=uuid.uuid4())


def test_list_returns_page(service, tenant_id) -> None:
    service.create(tenant_id=tenant_id, data=_create_payload(name="Landing listado"))
    page = service.list(tenant_id=tenant_id, page=1, page_size=20)
    assert page.page == 1
    assert page.page_size == 20
    assert page.total >= 1
    assert all(item.tenant_id == tenant_id for item in page.items)


def test_update_bumps_revision(service, tenant_id) -> None:
    created = service.create(tenant_id=tenant_id, data=_create_payload(name="Landing a renombrar"))
    updated = service.update(
        tenant_id=tenant_id,
        landing_id=created.id,
        data=LandingUpdate(name="Renombrada"),
    )
    assert updated.name == "Renombrada"
    assert updated.revision == 2


def test_update_empty_payload_raises(service, tenant_id) -> None:
    created = service.create(tenant_id=tenant_id, data=_create_payload(name="Landing update vacío"))
    with pytest.raises(InputValidationError):
        service.update(tenant_id=tenant_id, landing_id=created.id, data=LandingUpdate())


def test_update_missing_raises_not_found(service, tenant_id) -> None:
    with pytest.raises(NotFoundError):
        service.update(
            tenant_id=tenant_id,
            landing_id=uuid.uuid4(),
            data=LandingUpdate(name="X"),
        )


def test_delete_soft_deletes(service, tenant_id) -> None:
    created = service.create(tenant_id=tenant_id, data=_create_payload(name="Landing a borrar"))
    service.delete(tenant_id=tenant_id, landing_id=created.id)
    with pytest.raises(NotFoundError):
        service.get(tenant_id=tenant_id, landing_id=created.id)


def test_publish_sets_published_at(service, tenant_id) -> None:
    created = service.create(tenant_id=tenant_id, data=_create_payload(name="Landing a publicar"))
    published = service.publish(tenant_id=tenant_id, landing_id=created.id, published=True)
    assert published.published is True
    assert published.published_at is not None

    unpublished = service.publish(tenant_id=tenant_id, landing_id=created.id, published=False)
    assert unpublished.published is False
    assert unpublished.published_at is None


def test_compile_returns_html(service, tenant_id) -> None:
    result = service.compile(
        tenant_id=tenant_id,
        data=LandingCompileRequest(config={"title": "Compilada", "blocks": []}),
    )
    assert "<title>Compilada</title>" in result.html
    assert result.compiled_at is not None
