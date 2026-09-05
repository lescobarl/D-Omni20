"""Tests de integración del serving público del Portal del Cliente (C-3).

Cubre el nuevo ``GET /portal`` (ruta raíz, SIN ``X-Tenant-Id``) que:
- Resuelve el tenant por la cabecera ``Host`` contra ``pseo_hosts``
  (``get_pseo_tenant_by_host``); host ausente/desconocido/no registrado → 404.
- Sirve una página HTML autocontenida con ``#omnibotia-config``, los contenedores
  ``[data-omni-portal]``/``[data-omni-nav]`` que espera ``portal.js`` y la carga
  de ``{apiBaseUrl}/static/portal.js``.
- Inyecta la apariencia de ``tenant_appearance`` (paleta/logo/tipografía) como
  variables CSS ``--omni-*`` y dentro del config JSON (nada hardcodeado).
- Expone las páginas configurables EXCLUSIVAMENTE de ``portal_pages`` publicadas
  (configurador unificado, modo portal). Si el tenant no tiene ninguna página
  publicada en ``portal_pages``, el serving FALLA DE FORMA EXPLÍCITA (404
  "portal no configurado") — nunca se sirve contenido heredado de
  ``content_items kind="portal"`` ni páginas por defecto genéricas.

Regresión crítica: el template se rellena con ``.replace()`` de placeholders de
llave simple ``{...}`` (NO ``.format()``), así que el HTML servido no debe
contener ``{{``/``}}`` (antes rompía el bloque ``:root`` y el portal quedaba sin
estilos).
"""

from __future__ import annotations

import json
import re
import uuid
from typing import Any
from urllib.parse import urlparse

import pytest
from app.models.portal_page import PortalPage
from app.models.pseo_host import PseoHost
from app.models.tenant_config import ContentItem, TenantAppearance
from app.repositories.sqlalchemy_repositories import SqlAlchemyPseoHostRepository
from fastapi.testclient import TestClient
from sqlalchemy import delete

_DEV_HOST = "localhost:8000"
_UNKNOWN_HOST = "unknown.example.com"
_NOT_FOUND_CODE = "resource.not_found"

TENANT_HEADERS: dict[str, str] = {"X-Tenant-Id": "dev-tenant"}


@pytest.fixture(autouse=True)
def _auth_headers(tenant_admin_token: str) -> None:
    """Los endpoints de gestión (portal-pages, tenant/appearance) requieren RBAC."""
    TENANT_HEADERS["Authorization"] = f"Bearer {tenant_admin_token}"

_APPEARANCE_PAYLOAD: dict[str, str] = {
    "primary_color": "#112233",
    "accent_color": "#223344",
    "surface_color": "#FFFFFF",
    "text_color": "#000000",
    "brand_badge": "#112233",
}


@pytest.fixture(autouse=True)
def _clean_portal_data(container, tenant_id, test_settings) -> None:
    """Cada test parte de ``portal_pages``/``content_items``/``tenant_appearance``
    vacíos y con el host de desarrollo sembrado (mismo patrón que ``_clean_pseo``
    de test_pseo.py)."""
    with container.database.session_scope() as session:
        session.execute(
            delete(PortalPage).where(PortalPage.tenant_id == tenant_id)
        )
        session.execute(
            delete(ContentItem).where(ContentItem.tenant_id == tenant_id)
        )
        session.execute(
            delete(TenantAppearance).where(TenantAppearance.tenant_id == tenant_id)
        )
        session.execute(delete(PseoHost))
        host = urlparse(test_settings.cdn_base_url).netloc
        if host:
            SqlAlchemyPseoHostRepository(session).upsert(
                tenant_id=tenant_id, host=host
            )
        session.commit()
    yield


def _host_headers(host: str) -> dict[str, str]:
    return {"Host": host}


def _extract_portal_config(html: str) -> dict[str, Any]:
    """Extrae y decodifica el JSON de ``#omnibotia-config`` del HTML servido.

    El config se serializa con ``ensure_ascii=True`` (patrón seguro para
    ``<script>``), así que los caracteres acentuados aparecen escapados como
    ``\\u00f3`` en el HTML crudo. Al parsearlo con ``json.loads`` se recuperan
    los caracteres originales, lo que permite verificar que el contenido con
    acentos sobrevive intacto al round-trip (API → portal_pages → serving).
    """
    match = re.search(
        r'<script id="omnibotia-config" type="application/json">(.*?)</script>',
        html,
        re.DOTALL,
    )
    assert match is not None, "no se encontró #omnibotia-config en el HTML servido"
    return json.loads(match.group(1))


def _create_published_portal_page(
    client: TestClient, slug: str, title: str, body: str = ""
) -> dict[str, Any]:
    """Crea y publica una página del portal vía el configurador (``portal_pages``).

    ``blocks`` se envía como el dict envolvente ``{"slug", "title", "blocks"}``
    que persiste ``portal_pages`` y consume ``_blocks_to_content`` (mismo formato
    que genera el motor IA). Devuelve la página creada.
    """
    blocks: dict[str, Any] = {
        "slug": slug,
        "title": title,
        "blocks": [
            {
                "type": "about",
                "name": title,
                "config": {"title": title, "body": body or f"Contenido de {title}."},
            }
        ],
    }
    response = client.post(
        "/api/v1/portal-pages",
        json={"slug": slug, "title": title, "blocks": blocks},
        headers=TENANT_HEADERS,
    )
    assert response.status_code == 201, response.text
    page = response.json()
    pub = client.post(
        f"/api/v1/portal-pages/{page['id']}/publish",
        json={"published": True},
        headers=TENANT_HEADERS,
    )
    assert pub.status_code == 200, pub.text
    return pub.json()


def test_portal_without_published_pages_fails_loudly(client: TestClient) -> None:
    """Sin páginas publicadas en ``portal_pages`` el serving FALLA (404).

    FASE A: se eliminó el fallback a ``content_items kind="portal"`` y a las
    páginas por defecto. Un tenant sin portal configurado en ``portal_pages``
    debe responder 404 "portal no configurado" (fail-loudly), nunca servir
    contenido heredado/genérico que enmascare que el configurador no escribió.
    """
    response = client.get("/portal", headers=_host_headers(_DEV_HOST))
    assert response.status_code == 404, response.text
    error = response.json()["error"]
    assert error["code"] == _NOT_FOUND_CODE
    assert error["operation"] == "portal.serve.pages"
    assert "portal no configurado" in error["message"].lower()


def test_portal_config_has_dev_tenant_and_api_base(
    client: TestClient, tenant_id: uuid.UUID
) -> None:
    """El config JSON expone el tenant resuelto por Host y el origen del request."""
    _create_published_portal_page(client, slug="inicio", title="Mi portal")
    response = client.get("/portal", headers=_host_headers(_DEV_HOST))
    assert response.status_code == 200, response.text
    body = response.text
    assert f'"tenantId":"{tenant_id}"' in body
    # El apiBaseUrl se deriva del origen del request (Host header), no de un
    # valor fijo, para que el portal funcione desde cualquier origen.
    assert '"apiBaseUrl":"http://localhost:8000"' in body


def test_portal_config_uses_forwarded_origin_when_proxied(
    client: TestClient, tenant_id: uuid.UUID
) -> None:
    """Tras un proxy/túnel (ngrok), el apiBaseUrl usa la URL pública real.

    ``request.url.netloc`` refleja la cabecera ``Host``, que un túnel sobrescribe
    para resolver el tenant. El origen real llega en ``X-Forwarded-Proto`` y
    ``X-Forwarded-Host`` y debe preferirse para que el portal apunte al mismo
    origen con el que el navegador accedió.
    """
    _create_published_portal_page(client, slug="inicio", title="Mi portal")
    headers = {
        **_host_headers(_DEV_HOST),
        "X-Forwarded-Proto": "https",
        "X-Forwarded-Host": "dapper-transmeridionally-dee.ngrok-free.dev",
    }
    response = client.get("/portal", headers=headers)
    assert response.status_code == 200, response.text
    body = response.text
    assert f'"tenantId":"{tenant_id}"' in body
    assert (
        '"apiBaseUrl":"https://dapper-transmeridionally-dee.ngrok-free.dev"' in body
    )
    # El portal.js también debe cargarse desde el origen público real.
    assert (
        '<script src="https://dapper-transmeridionally-dee.ngrok-free.dev/static/portal.js"'
        in body
    )


def test_portal_applies_tenant_appearance(client: TestClient) -> None:
    """La paleta configurada vía ``PUT /tenant/appearance`` se refleja en el portal."""
    _create_published_portal_page(client, slug="inicio", title="Mi portal")
    put = client.put(
        "/api/v1/tenant/appearance", json=_APPEARANCE_PAYLOAD, headers=TENANT_HEADERS
    )
    assert put.status_code == 200, put.text
    response = client.get("/portal", headers=_host_headers(_DEV_HOST))
    assert response.status_code == 200, response.text
    body = response.text
    assert "--omni-primary: #112233;" in body
    assert "--omni-accent: #223344;" in body
    assert "--omni-card: #FFFFFF;" in body
    assert "--omni-text: #000000;" in body
    # El config JSON expone la apariencia con los mismos valores.
    assert '"primary":"#112233"' in body
    assert '"accent":"#223344"' in body
    assert '"logoUrl":""' in body


def test_portal_pages_served_from_portal_pages(client: TestClient) -> None:
    """Las páginas publicadas en ``portal_pages`` se sirven en ``/portal``.

    FASE A: la fuente de verdad es ``portal_pages``. Las páginas creadas y
    publicadas en el configurador unificado (modo portal) se serializan a
    ``{slug, title, content}`` dentro del config JSON del portal servido.
    """
    _create_published_portal_page(
        client, slug="servicios", title="Servicios", body="Nuestros servicios."
    )
    _create_published_portal_page(
        client, slug="ubicacion", title="Ubicación", body="Cómo llegar."
    )
    _create_published_portal_page(
        client, slug="contacto", title="Contacto", body="Escríbenos por WhatsApp."
    )
    response = client.get("/portal", headers=_host_headers(_DEV_HOST))
    assert response.status_code == 200, response.text
    body = response.text
    assert '"slug":"servicios"' in body
    assert '"slug":"ubicacion"' in body
    assert '"slug":"contacto"' in body
    assert '"title":"Servicios"' in body
    assert '"title":"Contacto"' in body
    # El contenido de cada página (serializado desde blocks) se expone. El config
    # se embebe con ensure_ascii=True (seguro para <script>), así que los acentos
    # aparecen escapados en el HTML crudo; se decodifican parseando el JSON para
    # verificar que el contenido acentuado sobrevive intacto al round-trip.
    config = _extract_portal_config(body)
    pages = {page["slug"]: page["content"] for page in config["pages"]}
    assert "Nuestros servicios." in pages["servicios"]
    assert "Cómo llegar." in pages["ubicacion"]
    assert "Escríbenos por WhatsApp." in pages["contacto"]
    # Las páginas publicadas en portal_pages son la única fuente: no hay
    # páginas por defecto genéricas (fallback eliminado en FASE A).
    assert '"slug":"acerca"' not in body
    assert '"slug":"mision-vision"' not in body


def test_unknown_host_returns_404(client: TestClient) -> None:
    """Host no registrado en ``pseo_hosts`` → 404 (sin leak entre tenants)."""
    response = client.get("/portal", headers=_host_headers(_UNKNOWN_HOST))
    assert response.status_code == 404
    assert response.json()["error"]["code"] == _NOT_FOUND_CODE
    assert response.json()["error"]["operation"] == "pseo.host.resolve"


def test_unregistered_default_host_returns_404(client: TestClient) -> None:
    """TestClient inyecta ``Host: testserver`` (no registrado) → 404."""
    response = client.get("/portal")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == _NOT_FOUND_CODE
