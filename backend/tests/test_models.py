"""Pruebas de los modelos con reglas CLAUDE (UUIDv4, tupla sync, soft-delete)."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.exc import IntegrityError

from app.models.landing import TenantLanding
from app.models.tenant import Tenant


def test_tenant_persists_sync_tuple(db_session) -> None:
    tenant = Tenant(slug="test-tenant", name="Tenant de prueba")
    db_session.add(tenant)
    db_session.flush()

    assert tenant.id is not None
    assert tenant.revision == 1
    assert tenant.deleted is False
    assert tenant.created_at is not None
    assert tenant.updated_at is not None
    assert tenant.slug == "test-tenant"


def test_landing_revision_bumps_on_update(db_session, tenant_id) -> None:
    landing = TenantLanding(
        tenant_id=tenant_id,
        campaign_id=uuid.uuid4(),
        slug="revision-original",
        name="Original",
        config={"title": "Hola"},
    )
    db_session.add(landing)
    db_session.flush()
    assert landing.revision == 1

    landing.name = "Actualizado"
    db_session.flush()
    assert landing.revision == 2
    assert landing.updated_at is not None


def test_landing_defaults(db_session, tenant_id) -> None:
    landing = TenantLanding(
        tenant_id=tenant_id, campaign_id=uuid.uuid4(), slug="defaults-x", name="X", config={}
    )
    db_session.add(landing)
    db_session.flush()

    assert landing.published is False
    assert landing.published_at is None
    assert landing.compiled_html is None
    assert landing.deleted is False
    assert landing.revision == 1


def test_landing_soft_delete(db_session, tenant_id) -> None:
    landing = TenantLanding(
        tenant_id=tenant_id, campaign_id=uuid.uuid4(), slug="soft-delete-x", name="X", config={}
    )
    db_session.add(landing)
    db_session.flush()

    landing.deleted = True
    db_session.flush()
    assert landing.deleted is True


def test_landing_unique_campaign_per_tenant(db_session, tenant_id) -> None:
    campaign_id = uuid.uuid4()
    db_session.add(
        TenantLanding(
            tenant_id=tenant_id, campaign_id=campaign_id, slug="unique-campaign-a", name="A", config={}
        )
    )
    db_session.flush()

    db_session.add(
        TenantLanding(
            tenant_id=tenant_id, campaign_id=campaign_id, slug="unique-campaign-b", name="B", config={}
        )
    )
    with pytest.raises(IntegrityError):
        db_session.flush()
    # Se restaura la transacción para no romper la fixture.
    db_session.rollback()


def test_tenant_slug_unique(db_session) -> None:
    db_session.add(Tenant(slug="unique-slug", name="A"))
    db_session.flush()

    db_session.add(Tenant(slug="unique-slug", name="B"))
    with pytest.raises(IntegrityError):
        db_session.flush()
    db_session.rollback()
