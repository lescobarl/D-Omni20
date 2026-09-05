"""Tests del auto-provisioning de subdominios de clientes (C-3 multired).

Valida ``app.services.client_subdomain.provision_client_subdomain``:

- Crea el host ``{slug}.{client_subdomain_base}`` en ``pseo_hosts`` como
  ``active`` (verificación implícita por ser wildcard del propio dominio base).
- ``client_subdomain_base`` vacío = subdominios desactivados (no crea nada).
- Idempotente (una sola fila ante llamadas repetidas).
- No colisiona con el host del CDN configurado.
- Integración: el portal se sirve vía el subdominio provisionado (200 + config).
"""

from __future__ import annotations

import uuid

from sqlalchemy import select

from app.models.pseo_host import PseoHost
from app.repositories.sqlalchemy_repositories import (
    SqlAlchemyPseoHostRepository,
    SqlAlchemyTenantRepository,
)
from app.services.client_subdomain import provision_client_subdomain

_BASE = "clientes.omni2.app"


def _new_tenant(session, *, slug: str | None = None):
    """Crea un tenant desechable y devuelve (tenant, session) con la sesión viva."""
    tenant = SqlAlchemyTenantRepository(session).create(
        slug=slug or f"cli-{uuid.uuid4().hex[:8]}",
        name="Cliente Test",
    )
    session.flush()
    return tenant


class TestProvisionClientSubdomain:
    def test_creates_slug_subdomain_as_active(self, container) -> None:
        with container.database.session_scope() as session:
            tenant = _new_tenant(session)
            host = provision_client_subdomain(
                session, tenant=tenant, client_subdomain_base=_BASE
            )
            session.commit()

            assert host == f"{tenant.slug}.{_BASE}"
            row = session.scalars(
                select(PseoHost).where(PseoHost.host == host)
            ).first()
            assert row is not None
            assert row.tenant_id == tenant.id
            assert row.status == "active"
            assert row.deleted is False
            # Verificación implícita (wildcard del propio dominio): sin token ni fecha.
            assert row.verify_token is None
            assert row.verified_at is None

    def test_empty_base_disables_provisioning(self, container) -> None:
        with container.database.session_scope() as session:
            tenant = _new_tenant(session)
            host = provision_client_subdomain(
                session, tenant=tenant, client_subdomain_base=""
            )
            session.commit()

            assert host is None
            rows = session.scalars(
                select(PseoHost).where(PseoHost.tenant_id == tenant.id)
            ).all()
            assert rows == []

    def test_base_with_dots_is_stripped(self, container) -> None:
        with container.database.session_scope() as session:
            tenant = _new_tenant(session)
            host = provision_client_subdomain(
                session, tenant=tenant, client_subdomain_base=f".{_BASE}"
            )
            session.commit()

            assert host == f"{tenant.slug}.{_BASE}"

    def test_provision_is_idempotent(self, container) -> None:
        with container.database.session_scope() as session:
            tenant = _new_tenant(session)
            host_a = provision_client_subdomain(
                session, tenant=tenant, client_subdomain_base=_BASE
            )
            host_b = provision_client_subdomain(
                session, tenant=tenant, client_subdomain_base=_BASE
            )
            session.commit()

            assert host_a == host_b == f"{tenant.slug}.{_BASE}"
            rows = session.scalars(
                select(PseoHost).where(PseoHost.host == host_a)
            ).all()
            assert len(rows) == 1

    def test_reactivates_soft_deleted_row(self, container) -> None:
        with container.database.session_scope() as session:
            tenant = _new_tenant(session)
            host = f"{tenant.slug}.{_BASE}"
            repository = SqlAlchemyPseoHostRepository(session)
            repository.create(tenant_id=tenant.id, host=host, verify_token="abc")
            session.flush()
            row = session.scalars(
                select(PseoHost).where(PseoHost.host == host)
            ).first()
            assert row is not None and row.status == "pending"
            assert repository.soft_delete(tenant_id=tenant.id, host_id=row.id) is True
            session.flush()

            host_provisioned = provision_client_subdomain(
                session, tenant=tenant, client_subdomain_base=_BASE
            )
            session.commit()

            assert host_provisioned == host
            rows = session.scalars(
                select(PseoHost).where(PseoHost.host == host)
            ).all()
            assert len(rows) == 1
            assert rows[0].status == "active"
            assert rows[0].deleted is False
            assert rows[0].tenant_id == tenant.id

    def test_cdn_host_collision_returns_none(self, container) -> None:
        with container.database.session_scope() as session:
            tenant = _new_tenant(session)
            host = f"{tenant.slug}.{_BASE}"
            result = provision_client_subdomain(
                session,
                tenant=tenant,
                client_subdomain_base=_BASE,
                cdn_host=host,
            )
            session.commit()

            assert result is None
            rows = session.scalars(
                select(PseoHost).where(PseoHost.tenant_id == tenant.id)
            ).all()
            assert rows == []


class TestProvisionedSubdomainServing:
    def test_portal_served_via_provisioned_subdomain(
        self, container, client, super_admin_token
    ) -> None:
        with container.database.session_scope() as session:
            tenant = _new_tenant(session)
            host = provision_client_subdomain(
                session, tenant=tenant, client_subdomain_base=_BASE
            )
            session.commit()

        # El tenant desechable no tiene páginas publicadas en ``portal_pages`` y el
        # serving del portal FALLA (404 "portal no configurado") si no las tiene.
        # Creamos y publicamos una página vía el configurador usando el token de
        # super-admin (atraviesa la comprobación de membresía para cualquier tenant).
        tenant_headers = {
            "X-Tenant-Id": str(tenant.id),
            "Authorization": f"Bearer {super_admin_token}",
        }
        slug = f"inicio-{tenant.slug}"
        blocks = {
            "slug": slug,
            "title": "Inicio",
            "blocks": [
                {
                    "type": "about",
                    "name": "Inicio",
                    "config": {"title": "Inicio", "body": "Bienvenido."},
                }
            ],
        }
        created = client.post(
            "/api/v1/portal-pages",
            json={"slug": slug, "title": "Inicio", "blocks": blocks},
            headers=tenant_headers,
        )
        assert created.status_code == 201, created.text
        page = created.json()
        published = client.post(
            f"/api/v1/portal-pages/{page['id']}/publish",
            json={"published": True},
            headers=tenant_headers,
        )
        assert published.status_code == 200, published.text

        # El serving público se resuelve por ``Host`` (sin RBAC).
        response = client.get("/portal", headers={"Host": host})

        assert response.status_code == 200
        # El portal inyecta el script ``#omnibotia-config`` (id sin el ``#``,
        # que es notación de selector CSS) con el tenantId del tenant resuelto.
        assert 'id="omnibotia-config"' in response.text
        assert "/static/portal.js" in response.text
        assert str(tenant.id) in response.text

    def test_unprovisioned_subdomain_returns_404(self, client) -> None:
        response = client.get(
            "/portal", headers={"Host": f"missing-{uuid.uuid4().hex[:8]}.{_BASE}"}
        )
        assert response.status_code == 404
