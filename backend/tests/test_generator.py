"""Tests de la matriz programática PSEO (Fase B): resolución segura + compilación.

Cubre:
- Resolución estricta por whitelist de 4 tokens (anti-SSTI → 422).
- Escape ``html.escape`` EN EL PUNTO DE SUSTITUCIÓN (anti-XSS, sin doble escape).
- Validación de filas: slugify estricto, precio numérico, sin duplicados, ≤ 500.
- Propiedad de la campaña (404 sin fuga cross-tenant) y tenant del header (403).
- Inyección del bloque ``seo_programmatic`` (contrato Fase A/D/E).
- Auditoría ``matrix.upload`` y ``batch.compile``.
"""

from __future__ import annotations

import html
import uuid

import pytest
from sqlalchemy import delete

from app.models.landing import TenantLanding
from app.repositories.sqlalchemy_repositories import SqlAlchemyLandingRepository


_AUTH: dict[str, str] = {}


@pytest.fixture(autouse=True)
def _auth_headers(super_admin_token: str) -> None:
    _AUTH["Authorization"] = f"Bearer {super_admin_token}"


@pytest.fixture(autouse=True)
def _clean_landings(container) -> None:
    """Limpia landings para evitar choques del slug único entre tests.

    ``db_session`` hace commit al finalizar (no hace rollback), por lo que las
    landings creadas con el slug por defecto ``landing-pseo`` persisten entre
    tests y violarían ``uq_tenant_landing_slug``.
    """
    with container.database.session_scope() as session:
        session.execute(delete(TenantLanding))
        session.commit()


def _tenant_headers(tenant_id: uuid.UUID) -> dict[str, str]:
    return {"X-Tenant-Id": str(tenant_id), **_AUTH}


def _seed_landing(
    db_session,
    tenant_id: uuid.UUID,
    *,
    campaign_id: uuid.UUID | None = None,
    name: str = "Landing PSEO",
    slug: str | None = None,
):
    repo = SqlAlchemyLandingRepository(db_session)
    landing = repo.create(
        tenant_id=tenant_id,
        campaign_id=campaign_id or uuid.uuid4(),
        slug=slug or "landing-pseo",
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


class TestMatrixUpload:
    def test_upload_resolves_and_compiles_201(self, client, tenant_id, db_session):
        landing = _seed_landing(db_session, tenant_id)
        response = client.post(
            f"/api/v1/generator/matrix-upload/{landing.campaign_id}",
            headers=_tenant_headers(tenant_id),
            json=_matrix_payload(),
        )
        assert response.status_code == 201
        body = response.json()
        assert body["tenant_id"] == str(tenant_id)
        assert body["campaign_id"] == str(landing.campaign_id)
        assert body["total_rows"] == 2
        assert body["resolved_rows"] == 2
        assert body["compiled_at"] is not None

        page = body["pages"][0]
        assert page["city"] == "guadalajara"
        assert page["service_slug"] == "plomeria"
        assert page["service_name"] == "Plomería 24h"
        assert page["offer_price"] == "1500"
        assert page["config"]["title"] == "Plomería 24h en guadalajara"
        assert page["html"] is not None
        assert "Plomería 24h en guadalajara" in page["html"]

    def test_upload_injects_seo_programmatic(self, client, tenant_id, db_session):
        landing = _seed_landing(db_session, tenant_id)
        response = client.post(
            f"/api/v1/generator/matrix-upload/{landing.campaign_id}",
            headers=_tenant_headers(tenant_id),
            json=_matrix_payload(),
        )
        assert response.status_code == 201
        body = response.json()
        assert body["pages"][0]["config"]["seo_programmatic"] == {
            "city": "guadalajara",
            "service_slug": "plomeria",
            "service_name": "Plomería 24h",
            "offer_price": "1500",
        }

    def test_upload_unknown_campaign_returns_404(self, client, tenant_id):
        missing = uuid.uuid4()
        response = client.post(
            f"/api/v1/generator/matrix-upload/{missing}",
            headers=_tenant_headers(tenant_id),
            json=_matrix_payload(),
        )
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "resource.not_found"

    def test_upload_campaign_of_other_tenant_returns_404(self, client, tenant_id, db_session):
        other_tenant = uuid.uuid4()
        landing = _seed_landing(db_session, other_tenant)
        response = client.post(
            f"/api/v1/generator/matrix-upload/{landing.campaign_id}",
            headers=_tenant_headers(tenant_id),
            json=_matrix_payload(),
        )
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "resource.not_found"

    def test_missing_tenant_header_is_forbidden(
        self, client, tenant_id, db_session, super_admin_token
    ):
        landing = _seed_landing(db_session, tenant_id)
        response = client.post(
            f"/api/v1/generator/matrix-upload/{landing.campaign_id}",
            json=_matrix_payload(),
            headers={"Authorization": f"Bearer {super_admin_token}"},
        )
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "tenant.isolation_violation"

    def test_template_config_ssti_rejected(self, client, tenant_id, db_session):
        landing = _seed_landing(db_session, tenant_id)
        payload = _matrix_payload(template_config={"title": "{{ config.__class__ }}"})
        response = client.post(
            f"/api/v1/generator/matrix-upload/{landing.campaign_id}",
            headers=_tenant_headers(tenant_id),
            json=payload,
        )
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "validation.input_error"

    def test_row_ssti_rejected(self, client, tenant_id, db_session):
        landing = _seed_landing(db_session, tenant_id)
        rows = [
            {
                "city": "mexico-city",
                "service_slug": "plomeria",
                "service_name": "{{ config.__class__ }}",
                "offer_price": "100",
            }
        ]
        response = client.post(
            f"/api/v1/generator/matrix-upload/{landing.campaign_id}",
            headers=_tenant_headers(tenant_id),
            json=_matrix_payload(rows=rows),
        )
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "validation.input_error"

    def test_xss_is_escaped_single_time(self, client, tenant_id, db_session):
        landing = _seed_landing(db_session, tenant_id)
        rows = [
            {
                "city": "mexico-city",
                "service_slug": "plomeria",
                "service_name": "<script>alert(1)</script>",
                "offer_price": "100",
            }
        ]
        response = client.post(
            f"/api/v1/generator/matrix-upload/{landing.campaign_id}",
            headers=_tenant_headers(tenant_id),
            json=_matrix_payload(rows=rows),
        )
        assert response.status_code == 201
        page = response.json()["pages"][0]
        compiled = page["html"]
        escaped_name = html.escape("<script>alert(1)</script>", quote=True)
        # Una sola frontera de escape: sin script crudo ni entidades dobles.
        assert "<script>alert(1)" not in compiled
        assert escaped_name in compiled
        assert html.escape(escaped_name, quote=True) not in compiled
        # El config resuelto también queda pre-escapado (única frontera de escape).
        assert page["config"]["seo_programmatic"]["service_name"] == escaped_name

    def test_traversal_city_slug_rejected(self, client, tenant_id, db_session):
        landing = _seed_landing(db_session, tenant_id)
        rows = [
            {
                "city": "../../etc",
                "service_slug": "plomeria",
                "service_name": "Plomería",
                "offer_price": "100",
            }
        ]
        response = client.post(
            f"/api/v1/generator/matrix-upload/{landing.campaign_id}",
            headers=_tenant_headers(tenant_id),
            json=_matrix_payload(rows=rows),
        )
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "validation.input_error"

    def test_traversal_service_slug_rejected(self, client, tenant_id, db_session):
        landing = _seed_landing(db_session, tenant_id)
        rows = [
            {
                "city": "mexico-city",
                "service_slug": "..\\..",
                "service_name": "Plomería",
                "offer_price": "100",
            }
        ]
        response = client.post(
            f"/api/v1/generator/matrix-upload/{landing.campaign_id}",
            headers=_tenant_headers(tenant_id),
            json=_matrix_payload(rows=rows),
        )
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "validation.input_error"

    def test_duplicate_rows_rejected(self, client, tenant_id, db_session):
        landing = _seed_landing(db_session, tenant_id)
        rows = [
            {
                "city": "guadalajara",
                "service_slug": "plomeria",
                "service_name": "Plomería",
                "offer_price": "100",
            },
            {
                "city": "guadalajara",
                "service_slug": "plomeria",
                "service_name": "Plomería 2",
                "offer_price": "200",
            },
        ]
        response = client.post(
            f"/api/v1/generator/matrix-upload/{landing.campaign_id}",
            headers=_tenant_headers(tenant_id),
            json=_matrix_payload(rows=rows),
        )
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "validation.input_error"

    def test_too_many_rows_rejected(self, client, tenant_id, db_session):
        landing = _seed_landing(db_session, tenant_id)
        rows = [
            {
                "city": f"city-{i}",
                "service_slug": f"serv-{i}",
                "service_name": f"Servicio {i}",
                "offer_price": "100",
            }
            for i in range(501)
        ]
        response = client.post(
            f"/api/v1/generator/matrix-upload/{landing.campaign_id}",
            headers=_tenant_headers(tenant_id),
            json=_matrix_payload(rows=rows),
        )
        assert response.status_code == 422

    def test_empty_rows_rejected(self, client, tenant_id, db_session):
        landing = _seed_landing(db_session, tenant_id)
        payload = _matrix_payload(rows=[])
        response = client.post(
            f"/api/v1/generator/matrix-upload/{landing.campaign_id}",
            headers=_tenant_headers(tenant_id),
            json=payload,
        )
        assert response.status_code == 422

    def test_invalid_price_rejected(self, client, tenant_id, db_session):
        landing = _seed_landing(db_session, tenant_id)
        rows = [
            {
                "city": "guadalajara",
                "service_slug": "plomeria",
                "service_name": "Plomería",
                "offer_price": "abc",
            }
        ]
        response = client.post(
            f"/api/v1/generator/matrix-upload/{landing.campaign_id}",
            headers=_tenant_headers(tenant_id),
            json=_matrix_payload(rows=rows),
        )
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "validation.input_error"

    def test_compile_false_returns_html_none(self, client, tenant_id, db_session):
        landing = _seed_landing(db_session, tenant_id)
        response = client.post(
            f"/api/v1/generator/matrix-upload/{landing.campaign_id}",
            headers=_tenant_headers(tenant_id),
            json=_matrix_payload(compile_pages=False),
        )
        assert response.status_code == 201
        body = response.json()
        assert body["resolved_rows"] == 2
        assert body["compiled_at"] is None
        assert all(page["html"] is None for page in body["pages"])

    def test_audits_matrix_upload_and_batch_compile(self, client, tenant_id, db_session):
        landing = _seed_landing(db_session, tenant_id)
        response = client.post(
            f"/api/v1/generator/matrix-upload/{landing.campaign_id}",
            headers=_tenant_headers(tenant_id),
            json=_matrix_payload(),
        )
        assert response.status_code == 201

        upload_audit = client.get(
            "/api/v1/audit?operation=matrix.upload&page_size=100",
            headers=_tenant_headers(tenant_id),
        )
        assert upload_audit.status_code == 200
        assert upload_audit.json()["total"] >= 1

        compile_audit = client.get(
            "/api/v1/audit?operation=batch.compile&page_size=100",
            headers=_tenant_headers(tenant_id),
        )
        assert compile_audit.status_code == 200
        assert compile_audit.json()["total"] >= 1
