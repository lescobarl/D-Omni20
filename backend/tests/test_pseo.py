"""Tests del serving público PSEO (Fase D): resolución por ``Host``, sitemap paginado
y persistencia versionada e idempotente.

Cubre:
- Resolución del tenant por la cabecera ``Host`` (``pseo_hosts``) SIN ``X-Tenant-Id``.
- Host ausente/desconocido → 404 (sin leak 403); página de otro tenant → 404.
- Serving ``GET /pseo/{slug_path}`` devuelve el HTML compilado pre-escapado.
- Sitemap: ``urlset`` único si hay ≤ 1000 páginas; ``sitemapindex`` con chunks de
  1000 si hay más (todo acotado al tenant resuelto por ``Host``).
- ``persist_matrix`` idempotente por hash (misma matriz → 1 lote, versiones 1);
  matriz cambiada → lote nuevo y ``version`` incrementada solo si el HTML cambió.
- Aislamiento a nivel repositorio: lecturas cross-tenant devuelven ``None``/``[]``/``0``.
"""

from __future__ import annotations

import json
import re
import uuid
from urllib.parse import urlparse

import pytest
from app.models.pseo_batch import PseoBatch
from app.models.pseo_host import PseoHost
from app.models.pseo_page import PseoPage
from app.repositories.sqlalchemy_repositories import (
    SqlAlchemyLandingRepository,
    SqlAlchemyPseoBatchRepository,
    SqlAlchemyPseoHostRepository,
    SqlAlchemyPseoPageRepository,
)
from sqlalchemy import delete, select

_DEV_HOST = "localhost:8000"
_OTHER_HOST = "other.localhost:8000"
_NOT_FOUND_CODE = "resource.not_found"


@pytest.fixture(autouse=True)
def _clean_pseo(container, tenant_id, test_settings) -> None:
    """Cada test parte de tablas PSEO vacías y con el host de desarrollo sembrado.

    El cliente HTTP (session-scoped) y ``test_generator`` (que corre antes)
    acumulan lotes/páginas vía ``persist_matrix``; sin limpiar, las aserciones de
    idempotencia/versiones fallarían. Además, ``pseo_hosts`` se re-siembra porque
    el lifespan de la app solo corre una vez al inicio de la sesión.
    """
    with container.database.session_scope() as session:
        session.execute(delete(PseoPage))
        session.execute(delete(PseoBatch))
        session.execute(delete(PseoHost))
        host = urlparse(test_settings.cdn_base_url).netloc
        if host:
            SqlAlchemyPseoHostRepository(session).upsert(tenant_id=tenant_id, host=host)
        session.commit()
    yield


def _tenant_headers(tenant_id: uuid.UUID) -> dict[str, str]:
    return {"X-Tenant-Id": str(tenant_id)}


def _host_headers(host: str) -> dict[str, str]:
    return {"Host": host}


def _seed_landing(
    db_session,
    tenant_id: uuid.UUID,
    *,
    campaign_id: uuid.UUID | None = None,
    name: str = "Landing PSEO",
):
    repo = SqlAlchemyLandingRepository(db_session)
    landing = repo.create(
        tenant_id=tenant_id,
        campaign_id=campaign_id or uuid.uuid4(),
        name=name,
        config={"title": name, "blocks": []},
    )
    db_session.commit()
    return landing


def _matrix_payload(
    template_config: dict | None = None,
    rows: list[dict] | None = None,
    compile_pages: bool = True,
) -> dict:
    return {
        "template_config": template_config
        if template_config is not None
        else {
            "title": "{{ service_name }} en {{ city }}",
            "workflowType": "lead_capture",
            "blocks": [
                {
                    "type": "hero",
                    "config": {
                        "title": "{{ service_name }} en {{ city }}",
                        "subtitle": "{{ city }} — {{ offer_price }}",
                    },
                }
            ],
        },
        "rows": rows
        if rows is not None
        else [
            {
                "city": "guadalajara",
                "service_slug": "plomeria",
                "service_name": "Plomería 24h",
                "offer_price": "1500",
            },
            {
                "city": "guadalajara",
                "service_slug": "electricista",
                "service_name": "Electricista",
                "offer_price": "1200.50",
            },
        ],
        "compile": compile_pages,
    }


def _post_matrix(client, tenant_id: uuid.UUID, campaign_id: uuid.UUID, *, payload: dict | None = None):
    return client.post(
        f"/api/v1/generator/matrix-upload/{campaign_id}",
        headers=_tenant_headers(tenant_id),
        json=payload if payload is not None else _matrix_payload(),
    )


def _matrix_payload_full() -> dict:
    """Matriz PSEO completa: ``geo_optimization`` + bloque FAQ (Fases C/E).

    Parte de ``_matrix_payload()`` y añade los datos de negocio local
    (LocalBusiness) y un bloque FAQ con 2 ítems para verificar en la página
    servida: canonical + embed (omnibotia-config + embed.js) + JSON-LD.
    """
    payload = _matrix_payload()
    payload["template_config"]["geo_optimization"] = {
        "local_business": {
            "name": "Plomería Guadalajara",
            "address": "Av. Chapultepec 123",
            "city": "Guadalajara",
            "state": "Jalisco",
            "country": "MX",
            "postal_code": "44100",
            "phone": "+523333333333",
            "geo": {"latitude": 20.6597, "longitude": -103.3496},
        }
    }
    payload["template_config"]["blocks"].append(
        {
            "type": "faq",
            "config": {
                "items": [
                    {"question": "¿Atienden 24h?", "answer": "Sí"},
                    {"question": "¿Dan garantía?", "answer": "Sí, 1 año"},
                ]
            },
        }
    )
    return payload


def _seed_pages(db_session, tenant_id: uuid.UUID, *, count: int) -> None:
    """Siembra ``count`` páginas publicadas directamente vía repositorios."""
    batch_repo = SqlAlchemyPseoBatchRepository(db_session)
    page_repo = SqlAlchemyPseoPageRepository(db_session)
    batch = batch_repo.create(
        tenant_id=tenant_id,
        campaign_id=uuid.uuid4(),
        matrix_hash=uuid.uuid4().hex,
        template_version="pseo",
        page_count=count,
    )
    for i in range(count):
        city = f"ciudad-{i // 100}"
        service_slug = f"servicio-{i % 100}"
        slug_path = f"{city}/{service_slug}"
        page_repo.upsert(
            tenant_id=tenant_id,
            batch_id=batch.id,
            slug_path=slug_path,
            city=city,
            service_slug=service_slug,
            service_name=f"Servicio {i}",
            offer_price=str(100 + i),
            canonical_url=f"http://localhost:8000/{slug_path}",
            compiled_html=f"<h1>{city} {service_slug}</h1>",
            version=1,
        )
    db_session.commit()


class TestServePage:
    def test_serves_compiled_html_by_host_200(self, client, tenant_id, db_session):
        landing = _seed_landing(db_session, tenant_id)
        assert _post_matrix(client, tenant_id, landing.campaign_id).status_code == 201

        response = client.get(
            "/pseo/guadalajara/plomeria", headers=_host_headers(_DEV_HOST)
        )
        assert response.status_code == 200
        assert "Plomería 24h en guadalajara" in response.text

    def test_page_not_found_returns_404(self, client, tenant_id, db_session):
        landing = _seed_landing(db_session, tenant_id)
        assert _post_matrix(client, tenant_id, landing.campaign_id).status_code == 201

        response = client.get(
            "/pseo/ciudad-99/servicio-99", headers=_host_headers(_DEV_HOST)
        )
        assert response.status_code == 404
        assert response.json()["error"]["code"] == _NOT_FOUND_CODE
        assert response.json()["error"]["operation"] == "pseo.serve"

    def test_page_of_other_tenant_returns_404(self, client, container, tenant_id, db_session):
        landing = _seed_landing(db_session, tenant_id)
        assert _post_matrix(client, tenant_id, landing.campaign_id).status_code == 201

        other_tenant = uuid.uuid4()
        with container.database.session_scope() as session:
            SqlAlchemyPseoHostRepository(session).upsert(
                tenant_id=other_tenant, host=_OTHER_HOST
            )
            session.commit()

        # El host resuelve a OTRO tenant: la página existe pero no le pertenece → 404.
        response = client.get(
            "/pseo/guadalajara/plomeria", headers=_host_headers(_OTHER_HOST)
        )
        assert response.status_code == 404
        assert response.json()["error"]["code"] == _NOT_FOUND_CODE
        assert "isolation" not in response.json()["error"]["code"]

    def test_unknown_host_returns_404(self, client):
        response = client.get(
            "/pseo/guadalajara/plomeria", headers=_host_headers("unknown.example.com")
        )
        assert response.status_code == 404
        assert response.json()["error"]["code"] == _NOT_FOUND_CODE
        assert response.json()["error"]["operation"] == "pseo.host.resolve"

    def test_unregistered_default_host_returns_404(self, client):
        # TestClient inyecta Host: testserver (no registrado en pseo_hosts).
        response = client.get("/pseo/guadalajara/plomeria")
        assert response.status_code == 404
        assert response.json()["error"]["code"] == _NOT_FOUND_CODE


class TestPersistIdempotent:
    def test_same_matrix_does_not_create_new_batch_or_version(
        self, client, container, tenant_id, db_session
    ):
        landing = _seed_landing(db_session, tenant_id)
        assert _post_matrix(client, tenant_id, landing.campaign_id).status_code == 201
        assert _post_matrix(client, tenant_id, landing.campaign_id).status_code == 201

        with container.database.session_scope() as session:
            batches = list(session.scalars(select(PseoBatch)).all())
            pages = list(session.scalars(select(PseoPage)).all())
        assert len(batches) == 1
        assert len(pages) == 2
        assert all(page.version == 1 for page in pages)

    def test_changed_matrix_creates_new_batch_and_bumps_version(
        self, client, container, tenant_id, db_session
    ):
        landing = _seed_landing(db_session, tenant_id)
        assert _post_matrix(client, tenant_id, landing.campaign_id).status_code == 201

        changed_rows = [
            {**row, "offer_price": "999"} if row["service_slug"] == "plomeria" else row
            for row in _matrix_payload()["rows"]
        ]
        assert (
            _post_matrix(
                client, tenant_id, landing.campaign_id, payload=_matrix_payload(rows=changed_rows)
            ).status_code
            == 201
        )

        with container.database.session_scope() as session:
            batches = list(session.scalars(select(PseoBatch)).all())
            pages = {
                page.slug_path: page
                for page in session.scalars(select(PseoPage)).all()
            }
        assert len(batches) == 2
        assert pages["guadalajara/plomeria"].version == 2
        assert pages["guadalajara/electricista"].version == 1


class TestSitemap:
    def test_single_urlset_when_under_page_size(self, client, tenant_id, db_session):
        landing = _seed_landing(db_session, tenant_id)
        assert _post_matrix(client, tenant_id, landing.campaign_id).status_code == 201

        response = client.get("/sitemap.xml", headers=_host_headers(_DEV_HOST))
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("application/xml")
        assert "<urlset" in response.text
        assert response.text.count("<url>") == 2
        assert "http://localhost:8000/guadalajara/plomeria" in response.text
        assert "http://localhost:8000/guadalajara/electricista" in response.text

    def test_sitemapindex_and_chunks_when_over_page_size(self, client, tenant_id, db_session):
        _seed_pages(db_session, tenant_id, count=1001)

        index = client.get("/sitemap.xml", headers=_host_headers(_DEV_HOST))
        assert index.status_code == 200
        assert "<sitemapindex" in index.text
        assert index.text.count("<sitemap>") == 2

        chunk1 = client.get("/sitemap-1.xml", headers=_host_headers(_DEV_HOST))
        assert chunk1.status_code == 200
        assert chunk1.text.count("<url>") == 1000

        chunk2 = client.get("/sitemap-2.xml", headers=_host_headers(_DEV_HOST))
        assert chunk2.status_code == 200
        assert chunk2.text.count("<url>") == 1

        chunk3 = client.get("/sitemap-3.xml", headers=_host_headers(_DEV_HOST))
        assert chunk3.status_code == 404
        assert chunk3.json()["error"]["code"] == _NOT_FOUND_CODE
        assert chunk3.json()["error"]["operation"] == "pseo.sitemap"


class TestRepoIsolation:
    def test_cross_tenant_reads_denied(self, db_session, tenant_id):
        _seed_pages(db_session, tenant_id, count=3)
        other_tenant = uuid.uuid4()

        page_repo = SqlAlchemyPseoPageRepository(db_session)
        assert (
            page_repo.get_by_slug_path(tenant_id=other_tenant, slug_path="ciudad-0/servicio-0")
            is None
        )
        assert page_repo.list_published(tenant_id=other_tenant, offset=0, limit=10) == []
        assert page_repo.count_published(tenant_id=other_tenant) == 0
        assert page_repo.count_published(tenant_id=tenant_id) == 3

        batch_repo = SqlAlchemyPseoBatchRepository(db_session)
        assert batch_repo.get_by_hash(tenant_id=other_tenant, matrix_hash="a" * 64) is None

    def test_host_maps_to_tenant(self, container, tenant_id):
        other_tenant = uuid.uuid4()
        with container.database.session_scope() as session:
            SqlAlchemyPseoHostRepository(session).upsert(
                tenant_id=other_tenant, host=_OTHER_HOST
            )
            session.commit()

        with container.database.session_scope() as session:
            host_repo = SqlAlchemyPseoHostRepository(session)
            other_row = host_repo.get_by_host(host=_OTHER_HOST)
            dev_row = host_repo.get_by_host(host=_DEV_HOST)
        assert other_row is not None and other_row.tenant_id == other_tenant
        assert dev_row is not None and dev_row.tenant_id == tenant_id


class TestEmbedAndJsonLd:
    """Fase C (embed) + Fase E (JSON-LD): canonical, omnibotia-config, embed.js."""

    def test_served_page_contains_canonical_embed_and_jsonld(
        self, client, tenant_id, db_session
    ):
        landing = _seed_landing(db_session, tenant_id)
        assert (
            _post_matrix(
                client,
                tenant_id,
                landing.campaign_id,
                payload=_matrix_payload_full(),
            ).status_code
            == 201
        )

        response = client.get(
            "/pseo/guadalajara/plomeria", headers=_host_headers(_DEV_HOST)
        )
        assert response.status_code == 200
        html = response.text

        # Fase E — canonical en el <head>.
        assert (
            '<link rel="canonical" href="http://localhost:8000/guadalajara/plomeria">'
            in html
        )

        # Fase C — config del embed inyectada por el backend.
        config_match = re.search(
            r'<script id="omnibotia-config" type="application/json">(.*?)</script>',
            html,
            flags=re.DOTALL,
        )
        assert config_match is not None
        embed_config = json.loads(config_match.group(1))
        assert embed_config["tenantId"] == str(tenant_id)
        assert embed_config["apiBaseUrl"] == "http://localhost:8000"

        # Fase C — <script src> del SDK (idéntico para todos los tenants).
        assert (
            '<script src="http://localhost:8000/static/embed.js" defer></script>'
            in html
        )

        # Fase E — JSON-LD LocalBusiness + Service + FAQPage válidos.
        jsonld = [
            json.loads(block)
            for block in re.findall(
                r'<script type="application/ld\+json">(.*?)</script>',
                html,
                flags=re.DOTALL,
            )
        ]
        types = {block["@type"] for block in jsonld}
        assert {"LocalBusiness", "Service", "FAQPage"} <= types

        service = next(b for b in jsonld if b["@type"] == "Service")
        assert service["name"] == "Plomería 24h"
        assert service["areaServed"] == "guadalajara"
        assert service["offers"]["price"] == "1500"

        local_business = next(b for b in jsonld if b["@type"] == "LocalBusiness")
        assert local_business["name"] == "Plomería Guadalajara"
        assert local_business["address"]["addressLocality"] == "Guadalajara"

        faq = next(b for b in jsonld if b["@type"] == "FAQPage")
        assert len(faq["mainEntity"]) == 2

    def test_static_embed_js_served_200(self, client):
        response = client.get("/static/embed.js")
        assert response.status_code == 200
        assert "javascript" in response.headers["content-type"]
        body = response.text
        assert "X-Tenant-Id" in body
        assert "omnibotia-config" in body
        assert "whatsapp_intent" not in body

    def test_cors_preflight_from_cdn_origin(self, client):
        response = client.options(
            "/api/v1/workflows/lead",
            headers={
                "Origin": "http://localhost:8000",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type,x-tenant-id",
                **_host_headers(_DEV_HOST),
            },
        )
        assert response.status_code == 200
        assert (
            response.headers["access-control-allow-origin"] == "http://localhost:8000"
        )
        assert "POST" in response.headers["access-control-allow-methods"]
        assert (
            "x-tenant-id"
            in response.headers["access-control-allow-headers"].lower()
        )

    def test_cors_preflight_from_disallowed_origin(self, client):
        response = client.options(
            "/api/v1/workflows/lead",
            headers={
                "Origin": "http://evil.example.com",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type,x-tenant-id",
                **_host_headers(_DEV_HOST),
            },
        )
        assert "access-control-allow-origin" not in response.headers

    def test_cors_simple_request_embed_js(self, client):
        allowed = client.get(
            "/static/embed.js", headers={"Origin": "http://localhost:8000"}
        )
        assert allowed.status_code == 200
        assert (
            allowed.headers["access-control-allow-origin"] == "http://localhost:8000"
        )

        denied = client.get(
            "/static/embed.js", headers={"Origin": "http://evil.example.com"}
        )
        assert denied.status_code == 200
        assert "access-control-allow-origin" not in denied.headers
