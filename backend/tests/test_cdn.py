"""Tests de los endpoints de despliegue al CDN (Fase 10).

Cubre:
- ``POST /api/v1/cdn/deploy/{landing_id}`` (despliegue versionado, acotado al tenant).
- Serving público ``GET /cdn/{landing_id}/v{version}``: resuelve el tenant por la
  cabecera ``Host`` contra ``pseo_hosts`` (sin ``X-Tenant-Id``) y devuelve el HTML
  compilado; host ausente/desconocido o versión de otro tenant → 404 (sin leak).

La ``url`` de despliegue se acota al subdominio dinámico del tenant (C-3 multired):
``{scheme}://{slug}.{client_subdomain_base}/cdn/{landing_id}/v{version}``. En tests
el tenant de desarrollo usa ``slug="dev-tenant"`` y ``client_subdomain_base`` por
defecto ``clientes.omni2.app``, por lo que la URL esperada es
``http://dev-tenant.clientes.omni2.app/cdn/{landing_id}/v{version}``.
"""

from __future__ import annotations

import uuid
from urllib.parse import urlparse

import pytest
from sqlalchemy import delete, select

from app.models.cdn_deployment import CdnDeployment
from app.models.landing import TenantLanding
from app.models.pseo_host import PseoHost
from app.repositories.sqlalchemy_repositories import (
    SqlAlchemyLandingRepository,
    SqlAlchemyPseoHostRepository,
)


_AUTH: dict[str, str] = {}


@pytest.fixture(autouse=True)
def _auth_headers(super_admin_token: str) -> None:
    _AUTH["Authorization"] = f"Bearer {super_admin_token}"


@pytest.fixture(autouse=True)
def _clean_cdn_deployments(container) -> None:
    """Cada test parte de una tabla de despliegues vacía (los insert vía HTTP commit).

    El cliente HTTP (session-scoped) commitea los despliegues a la base temporal
    compartida y ``db_session`` también hace commit al finalizar; sin limpiar,
    las aserciones de versión incremental (v1, v2, ...) fallarían por acumulación.
    """
    with container.database.session_scope() as session:
        session.execute(delete(CdnDeployment))
        session.commit()
    yield


def _tenant_headers(tenant_id: uuid.UUID) -> dict[str, str]:
    return {"X-Tenant-Id": str(tenant_id), **_AUTH}


def _seed_landing(
    db_session,
    tenant_id: uuid.UUID,
    *,
    name: str = "Landing CDN",
    slug: str | None = None,
):
    repo = SqlAlchemyLandingRepository(db_session)
    landing = repo.create(
        tenant_id=tenant_id,
        campaign_id=uuid.uuid4(),
        slug=slug or "landing-cdn",
        name=name,
        config={"title": name, "blocks": []},
    )
    db_session.commit()
    return landing


class TestDeployLanding:
    @pytest.fixture(autouse=True)
    def _clean_landings(self, container) -> None:
        """Limpia landings para evitar choques del slug único entre tests.

        ``db_session`` hace commit al finalizar (no hace rollback), por lo que
        las landings creadas con el slug por defecto ``landing-cdn`` persisten
        entre tests y violarían ``uq_tenant_landing_slug``.
        """
        with container.database.session_scope() as session:
            session.execute(delete(TenantLanding))
            session.commit()

    def test_deploy_returns_201_with_versioned_url(self, client, tenant_id, db_session):
        landing = _seed_landing(db_session, tenant_id)
        response = client.post(
            f"/api/v1/cdn/deploy/{landing.id}",
            headers=_tenant_headers(tenant_id),
        )
        assert response.status_code == 201
        body = response.json()
        assert body["landing_id"] == str(landing.id)
        assert body["version"] == 1
        assert body["status"] == "deployed"
        assert body["url"] == f"http://dev-tenant.clientes.omni2.app/cdn/{landing.id}/v1"
        assert "deployed_at" in body
        assert "created_at" in body

    def test_deploy_increments_version_on_second_deploy(self, client, tenant_id, db_session):
        landing = _seed_landing(db_session, tenant_id)
        first = client.post(
            f"/api/v1/cdn/deploy/{landing.id}",
            headers=_tenant_headers(tenant_id),
        )
        assert first.status_code == 201
        assert first.json()["version"] == 1

        second = client.post(
            f"/api/v1/cdn/deploy/{landing.id}",
            headers=_tenant_headers(tenant_id),
        )
        assert second.status_code == 201
        body = second.json()
        assert body["version"] == 2
        assert body["url"] == f"http://dev-tenant.clientes.omni2.app/cdn/{landing.id}/v2"

    def test_deploy_landing_not_found_returns_404(self, client, tenant_id):
        missing = uuid.uuid4()
        response = client.post(
            f"/api/v1/cdn/deploy/{missing}",
            headers=_tenant_headers(tenant_id),
        )
        assert response.status_code == 404

    def test_deploy_landing_of_other_tenant_returns_404(self, client, tenant_id, db_session):
        other_tenant = uuid.uuid4()
        landing = _seed_landing(db_session, other_tenant)
        response = client.post(
            f"/api/v1/cdn/deploy/{landing.id}",
            headers=_tenant_headers(tenant_id),
        )
        assert response.status_code == 404

    def test_deploy_audits_operation(self, client, tenant_id, db_session):
        landing = _seed_landing(db_session, tenant_id)
        response = client.post(
            f"/api/v1/cdn/deploy/{landing.id}",
            headers=_tenant_headers(tenant_id),
        )
        assert response.status_code == 201
        audit_response = client.get(
            "/api/v1/audit?operation=cdn.deploy&page_size=100",
            headers=_tenant_headers(tenant_id),
        )
        assert audit_response.status_code == 200
        assert audit_response.json()["total"] >= 1

    def test_missing_tenant_header_is_forbidden(
        self, client, tenant_id, db_session, super_admin_token
    ):
        landing = _seed_landing(db_session, tenant_id)
        response = client.post(
            f"/api/v1/cdn/deploy/{landing.id}",
            headers={"Authorization": f"Bearer {super_admin_token}"},
        )
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "tenant.isolation_violation"


class TestServeDeployment:
    """Serving público ``GET /cdn/{landing_id}/v{version}`` (resolución por ``Host``)."""

    @pytest.fixture(autouse=True)
    def _clean_landings(self, container) -> None:
        """Limpia landings para evitar choques del slug único entre tests."""
        with container.database.session_scope() as session:
            session.execute(delete(TenantLanding))
            session.commit()

    @pytest.fixture(autouse=True)
    def _seed_dev_host(self, container, tenant_id, test_settings) -> None:
        """Re-siembra el host de desarrollo en ``pseo_hosts`` (el lifespan solo corre
        una vez por sesión y otros tests pueden limpiar la tabla)."""
        with container.database.session_scope() as session:
            session.execute(delete(PseoHost))
            host = urlparse(test_settings.cdn_base_url).netloc
            if host:
                SqlAlchemyPseoHostRepository(session).upsert(tenant_id=tenant_id, host=host)
            session.commit()

    def _deploy(self, client, tenant_id, landing_id) -> dict:
        response = client.post(
            f"/api/v1/cdn/deploy/{landing_id}",
            headers=_tenant_headers(tenant_id),
        )
        assert response.status_code == 201
        return response.json()

    def test_serve_returns_compiled_html_by_host(self, client, tenant_id, db_session, test_settings):
        landing = _seed_landing(db_session, tenant_id)
        deployment = self._deploy(client, tenant_id, landing.id)
        host = urlparse(test_settings.cdn_base_url).netloc
        response = client.get(
            f"/cdn/{landing.id}/v{deployment['version']}",
            headers={"Host": host},
        )
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/html")
        assert "Landing CDN" in response.text

    def test_serve_rewrites_api_base_to_forwarded_origin(
        self, client, tenant_id, db_session, test_settings
    ):
        """Tras un proxy/túnel (ngrok), el apiBaseUrl se reescribe a la URL pública.

        El HTML se despliega con un ``apiBaseUrl`` determinista del tenant. Al
        servirse tras un túnel, ``request.url.netloc`` refleja la cabecera
        ``Host`` sobrescrita para resolver el tenant, por lo que el origen real
        (``X-Forwarded-Proto``/``X-Forwarded-Host``) debe preferirse y el valor
        reescrito debe ser JSON válido (sin comillas sobrantes).
        """
        landing = _seed_landing(db_session, tenant_id)
        deployment = self._deploy(client, tenant_id, landing.id)
        host = urlparse(test_settings.cdn_base_url).netloc
        response = client.get(
            f"/cdn/{landing.id}/v{deployment['version']}",
            headers={
                "Host": host,
                "X-Forwarded-Proto": "https",
                "X-Forwarded-Host": "dapper-transmeridionally-dee.ngrok-free.dev",
            },
        )
        assert response.status_code == 200
        body = response.text
        assert (
            '"apiBaseUrl":"https://dapper-transmeridionally-dee.ngrok-free.dev"'
            in body
        )
        # El JSON no debe quedar malformado (sin comilla de cierre sobrante).
        assert '"apiBaseUrl":"https://dapper-transmeridionally-dee.ngrok-free.dev""' not in body

    def test_serve_rewrites_embed_src_to_forwarded_origin(
        self, client, tenant_id, db_session, test_settings
    ):
        """El ``src`` de ``embed.js`` se reescribe al origen real (evita mixed-content).

        El ``<script src=".../static/embed.js">`` se hornea en el despliegue con
        el esquema/puerto del CDN configurado (p. ej. ``http://...``). Al servirse
        por HTTPS tras un proxy/túnel, ese ``src`` absoluto ``http://`` provoca
        **mixed-content** y el navegador bloquea el SDK. ``serve`` debe reescribir
        el ``src`` al origen real (``X-Forwarded-Proto``/``X-Forwarded-Host``)
        para que el script se cargue por el mismo esquema y puerto que la página.
        """
        landing = _seed_landing(db_session, tenant_id)
        deployment = self._deploy(client, tenant_id, landing.id)
        host = urlparse(test_settings.cdn_base_url).netloc
        response = client.get(
            f"/cdn/{landing.id}/v{deployment['version']}",
            headers={
                "Host": host,
                "X-Forwarded-Proto": "https",
                "X-Forwarded-Host": "dapper-transmeridionally-dee.ngrok-free.dev",
            },
        )
        assert response.status_code == 200
        body = response.text
        assert (
            '<script src="https://dapper-transmeridionally-dee.ngrok-free.dev/static/embed.js" defer>'
            in body
        )
        # No debe quedar el src absoluto http:// original (mixed-content).
        assert "http://" + host + "/static/embed.js" not in body

    def test_serve_rewrites_tenant_id_to_resolved_tenant(
        self, client, tenant_id, db_session, test_settings
    ):
        """El ``tenantId`` del ``#omnibotia-config`` se reescribe al tenant resuelto.

        Aunque el HTML almacenado tenga un ``tenantId`` obsoleto/incorrecto (p. ej.
        por un despliegue previo bajo otro contexto), al servirse por ``Host`` el
        ``tenantId`` debe reescribirse al tenant resuelto del request
        (comportamiento multi-tenant correcto, sin hard-code).
        """
        landing = _seed_landing(db_session, tenant_id)
        deployment = self._deploy(client, tenant_id, landing.id)

        # Corrompe el ``tenantId`` almacenado para simular un HTML desplegado bajo
        # un contexto de tenant distinto (stale). ``serve`` debe reescribirlo.
        stale_tenant = uuid.uuid4()
        with db_session.begin():
            row = db_session.scalar(
                select(CdnDeployment).where(
                    CdnDeployment.tenant_id == tenant_id,
                    CdnDeployment.landing_id == landing.id,
                    CdnDeployment.version == deployment["version"],
                )
            )
            assert row is not None
            row.html = row.html.replace(
                f'"tenantId":"{tenant_id}"', f'"tenantId":"{stale_tenant}"'
            )

        host = urlparse(test_settings.cdn_base_url).netloc
        response = client.get(
            f"/cdn/{landing.id}/v{deployment['version']}",
            headers={"Host": host},
        )
        assert response.status_code == 200
        assert f'"tenantId":"{tenant_id}"' in response.text
        assert f'"tenantId":"{stale_tenant}"' not in response.text

    def test_serve_unknown_host_returns_404(self, client, tenant_id, db_session):
        landing = _seed_landing(db_session, tenant_id)
        deployment = self._deploy(client, tenant_id, landing.id)
        response = client.get(
            f"/cdn/{landing.id}/v{deployment['version']}",
            headers={"Host": "unknown.localhost:8000"},
        )
        assert response.status_code == 404

    def test_serve_missing_version_returns_404(self, client, tenant_id, db_session, test_settings):
        landing = _seed_landing(db_session, tenant_id)
        self._deploy(client, tenant_id, landing.id)
        host = urlparse(test_settings.cdn_base_url).netloc
        response = client.get(
            f"/cdn/{landing.id}/v999",
            headers={"Host": host},
        )
        assert response.status_code == 404

    def test_serve_landing_of_other_tenant_returns_404(self, client, tenant_id, db_session, test_settings):
        other_tenant = uuid.uuid4()
        landing = _seed_landing(db_session, other_tenant)
        deployment = self._deploy(client, other_tenant, landing.id)
        host = urlparse(test_settings.cdn_base_url).netloc
        response = client.get(
            f"/cdn/{landing.id}/v{deployment['version']}",
            headers={"Host": host},
        )
        assert response.status_code == 404


class TestServeRoot:
    """Serving público de la raíz ``GET /`` (resolución por ``Host``)."""

    @pytest.fixture(autouse=True)
    def _seed_dev_host(self, container, tenant_id, test_settings) -> None:
        """Re-siembra el host de desarrollo y limpia landings (aislamiento por test)."""
        with container.database.session_scope() as session:
            session.execute(delete(TenantLanding))
            session.execute(delete(PseoHost))
            host = urlparse(test_settings.cdn_base_url).netloc
            if host:
                SqlAlchemyPseoHostRepository(session).upsert(tenant_id=tenant_id, host=host)
            session.commit()

    def _deploy(self, client, tenant_id, landing_id) -> dict:
        response = client.post(
            f"/api/v1/cdn/deploy/{landing_id}",
            headers=_tenant_headers(tenant_id),
        )
        assert response.status_code == 201
        return response.json()

    def _publish(self, db_session, tenant_id, landing_id) -> None:
        repo = SqlAlchemyLandingRepository(db_session)
        repo.publish(tenant_id=tenant_id, landing_id=landing_id, published=True)
        db_session.commit()

    def test_root_redirects_to_portal_even_with_published_landing(
        self, client, tenant_id, db_session, test_settings
    ):
        """La raíz nunca sirve la landing directamente: redirige al Portal.

        La landing inicial no vive en la raíz; cada landing tiene su propia URL
        amigable ``/l/{slug}``. La raíz del subdominio siempre redirige a
        ``/portal`` (307), haya o no landing publicada.
        """
        landing = _seed_landing(db_session, tenant_id)
        self._deploy(client, tenant_id, landing.id)
        self._publish(db_session, tenant_id, landing.id)
        host = urlparse(test_settings.cdn_base_url).netloc
        response = client.get("/", headers={"Host": host}, follow_redirects=False)
        assert response.status_code == 307
        assert response.headers["location"] == "/portal"

    def test_root_redirects_to_portal_when_no_published_landing(
        self, client, tenant_id, db_session, test_settings
    ):
        landing = _seed_landing(db_session, tenant_id)
        self._deploy(client, tenant_id, landing.id)
        host = urlparse(test_settings.cdn_base_url).netloc
        response = client.get("/", headers={"Host": host}, follow_redirects=False)
        assert response.status_code == 307
        assert response.headers["location"] == "/portal"

    def test_root_unknown_host_returns_404(self, client, tenant_id, db_session):
        landing = _seed_landing(db_session, tenant_id)
        self._deploy(client, tenant_id, landing.id)
        self._publish(db_session, tenant_id, landing.id)
        response = client.get("/", headers={"Host": "unknown.localhost:8000"})
        assert response.status_code == 404


class TestServeSlug:
    """Serving público por URL amigable ``GET /l/{slug}`` (resolución por ``Host``)."""

    @pytest.fixture(autouse=True)
    def _seed_dev_host(self, container, tenant_id, test_settings) -> None:
        """Re-siembra el host de desarrollo y limpia landings (aislamiento por test)."""
        with container.database.session_scope() as session:
            session.execute(delete(TenantLanding))
            session.execute(delete(PseoHost))
            host = urlparse(test_settings.cdn_base_url).netloc
            if host:
                SqlAlchemyPseoHostRepository(session).upsert(tenant_id=tenant_id, host=host)
            session.commit()

    def _deploy(self, client, tenant_id, landing_id) -> dict:
        response = client.post(
            f"/api/v1/cdn/deploy/{landing_id}",
            headers=_tenant_headers(tenant_id),
        )
        assert response.status_code == 201
        return response.json()

    def _publish(self, db_session, tenant_id, landing_id) -> None:
        repo = SqlAlchemyLandingRepository(db_session)
        repo.publish(tenant_id=tenant_id, landing_id=landing_id, published=True)
        db_session.commit()

    def test_serves_published_landing_by_slug(self, client, tenant_id, db_session, test_settings):
        landing = _seed_landing(db_session, tenant_id, slug="casa-vista-lago")
        self._deploy(client, tenant_id, landing.id)
        self._publish(db_session, tenant_id, landing.id)
        host = urlparse(test_settings.cdn_base_url).netloc
        response = client.get("/l/casa-vista-lago", headers={"Host": host})
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/html")
        assert "Landing CDN" in response.text

    def test_unpublished_landing_by_slug_returns_404(self, client, tenant_id, db_session, test_settings):
        landing = _seed_landing(db_session, tenant_id, slug="casa-vista-lago")
        self._deploy(client, tenant_id, landing.id)
        host = urlparse(test_settings.cdn_base_url).netloc
        response = client.get("/l/casa-vista-lago", headers={"Host": host})
        assert response.status_code == 404

    def test_unknown_slug_returns_404(self, client, tenant_id, db_session, test_settings):
        landing = _seed_landing(db_session, tenant_id, slug="casa-vista-lago")
        self._deploy(client, tenant_id, landing.id)
        self._publish(db_session, tenant_id, landing.id)
        host = urlparse(test_settings.cdn_base_url).netloc
        response = client.get("/l/otra-landing", headers={"Host": host})
        assert response.status_code == 404

    def test_slug_unknown_host_returns_404(self, client, tenant_id, db_session):
        landing = _seed_landing(db_session, tenant_id, slug="casa-vista-lago")
        self._deploy(client, tenant_id, landing.id)
        self._publish(db_session, tenant_id, landing.id)
        response = client.get("/l/casa-vista-lago", headers={"Host": "unknown.localhost:8000"})
        assert response.status_code == 404
