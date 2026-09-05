"""Pruebas del compilador de landings (Jinja2, alineado a ``ILandingConfig``)."""

from __future__ import annotations

import json
import re

import pytest

from app.core.errors import InputValidationError
from app.services.compiler_service import JinjaCompilerService


def _compile(config: dict, template_name: str = "default") -> str:
    return JinjaCompilerService().compile(config=config, template_name=template_name)


def _jsonld_blocks(html: str) -> list[dict]:
    """Extrae y deserializa los bloques JSON-LD de un HTML compilado (Fase E)."""
    raw_blocks = re.findall(
        r'<script type="application/ld\+json">(.*?)</script>', html, flags=re.DOTALL
    )
    return [json.loads(block) for block in raw_blocks]


def _pseo_config(**overrides: object) -> dict:
    """Config PSEO mínimo con ``seo_programmatic`` poblado (Fase E)."""
    config: dict = {
        "title": "Plomería en Guadalajara",
        "workflowType": "lead_capture",
        "seo_programmatic": {
            "city": "guadalajara",
            "service_slug": "plomeria",
            "service_name": "Plomería 24h",
            "offer_price": "1500",
        },
        "blocks": [],
    }
    config.update(overrides)
    return config


def test_compile_renders_title() -> None:
    html = _compile({"title": "Mi Landing", "blocks": []})
    assert "<title>Mi Landing</title>" in html


def test_compile_default_title_when_missing() -> None:
    html = _compile({"blocks": []})
    assert "<title>Landing</title>" in html


def test_compile_autoescapes_unsafe_title() -> None:
    html = _compile({"title": "<script>alert('x')</script>"})
    assert "&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;" in html
    assert "<script>alert" not in html


def test_compile_renders_custom_css() -> None:
    html = _compile({"custom_css": "body { color: red; }"})
    assert "body { color: red; }" in html


def test_compile_hero_block() -> None:
    html = _compile(
        {
            "blocks": [
                {
                    "type": "hero",
                    "config": {
                        "title": "Título Hero",
                        "subtitle": "Subtítulo",
                        "cta_text": "Empezar",
                        "cta_url": "/go",
                    },
                }
            ]
        }
    )
    assert "Título Hero" in html
    assert "Subtítulo" in html
    assert 'href="/go"' in html
    assert "Empezar" in html


def test_compile_services_grid_block() -> None:
    html = _compile(
        {
            "blocks": [
                {
                    "type": "services_grid",
                    "config": {
                        "services": [
                            {"title": "Servicio A", "description": "Desc A"},
                            {"title": "Servicio B", "description": "Desc B"},
                        ]
                    },
                }
            ]
        }
    )
    assert "Servicio A" in html
    assert "Desc B" in html


def test_compile_lead_form_block() -> None:
    html = _compile(
        {
            "blocks": [
                {
                    "type": "lead_form",
                    "config": {
                        "fields": [{"label": "Nombre", "name": "nombre", "input_type": "text"}],
                        "submit_text": "Enviar",
                    },
                }
            ]
        }
    )
    assert "Nombre" in html
    assert "Enviar" in html
    # Captura de prospectos con atribución UTM (C-1, eslabón ②):
    assert 'data-lead-capture' in html
    assert "/api/v1/workflows/lead" in html
    assert "X-Tenant-Id" in html
    for utm_key in ("utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"):
        assert utm_key in html
    # El script degrada sin romper si el embed config (omnibotia-config) no existe:
    assert "if (!form || !configEl) { return; }" in html


def test_compile_lead_form_pseo_template() -> None:
    """La plantilla PSEO también compila el formulario con captura de lead y UTM."""
    config = _pseo_config(
        blocks=[
            {
                "type": "lead_form",
                "config": {
                    "fields": [{"label": "Nombre", "name": "nombre", "input_type": "text"}],
                    "submit_text": "Enviar",
                },
            }
        ]
    )
    html = _compile(config, template_name="pseo")
    assert 'data-lead-capture' in html
    assert "/api/v1/workflows/lead" in html
    assert "X-Tenant-Id" in html
    assert "utm_campaign" in html
    assert "if (!form || !configEl) { return; }" in html


def test_compile_portal_block() -> None:
    """El bloque ``portal`` (C-3) compila su sección y el cargador del widget."""
    html = _compile(
        {
            "blocks": [
                {
                    "type": "portal",
                    "config": {
                        "title": "Mi portal",
                        "subtitle": "Consulta el estado de tus pagos, cotizaciones y citas.",
                        "button_text": "Entrar a mi portal",
                    },
                }
            ]
        }
    )
    assert 'data-omni-portal' in html
    assert "Mi portal" in html
    assert "Entrar a mi portal" in html
    # El bloque inyecta el cargador del widget del Portal del Cliente:
    assert "/static/portal.js" in html
    assert "if (!container || !configEl) { return; }" in html


def test_compile_portal_pseo_template() -> None:
    """La plantilla PSEO también compila el bloque del Portal del Cliente."""
    config = _pseo_config(
        blocks=[
            {
                "type": "portal",
                "config": {
                    "title": "Mi portal",
                    "subtitle": "Consulta el estado de tus pagos.",
                    "button_text": "Entrar a mi portal",
                },
            }
        ]
    )
    html = _compile(config, template_name="pseo")
    assert 'data-omni-portal' in html
    assert "/static/portal.js" in html
    assert "if (!container || !configEl) { return; }" in html


def test_compile_non_dict_raises_input_validation() -> None:
    with pytest.raises(InputValidationError) as exc_info:
        JinjaCompilerService().compile(config="no soy dict")  # type: ignore[arg-type]
    assert exc_info.value.operation == "landing.compile"
    assert exc_info.value.context == {"template_name": "default"}


def test_compile_unknown_template_falls_back_to_default() -> None:
    html = _compile({"title": "Fallback"}, template_name="no-existe")
    assert "<title>Fallback</title>" in html


def test_compile_pseo_renders_service_jsonld() -> None:
    html = _compile(_pseo_config(), template_name="pseo")
    service = next(b for b in _jsonld_blocks(html) if b["@type"] == "Service")
    assert service["name"] == "Plomería 24h"
    assert service["areaServed"] == "guadalajara"
    assert service["offers"]["price"] == "1500"
    assert service["offers"]["priceCurrency"] == "MXN"


def test_compile_pseo_renders_local_business_jsonld() -> None:
    html = _compile(
        _pseo_config(
            geo_optimization={
                "local_business": {
                    "name": "Plomería Master",
                    "address": "Av. Chapultepec 123",
                    "city": "Guadalajara",
                    "state": "Jalisco",
                    "country": "MX",
                    "postal_code": "44100",
                    "phone": "+523333333333",
                    "geo": {"latitude": 20.6597, "longitude": -103.3496},
                }
            }
        ),
        template_name="pseo",
    )
    local_business = next(
        b for b in _jsonld_blocks(html) if b["@type"] == "LocalBusiness"
    )
    assert local_business["name"] == "Plomería Master"
    assert local_business["address"]["addressLocality"] == "Guadalajara"
    assert local_business["address"]["addressCountry"] == "MX"
    assert local_business["address"]["postalCode"] == "44100"
    assert local_business["telephone"] == "+523333333333"
    assert isinstance(local_business["geo"]["latitude"], (int, float))
    assert local_business["geo"]["longitude"] == -103.3496


def test_compile_pseo_renders_faq_jsonld() -> None:
    config = _pseo_config(
        blocks=[
            {
                "type": "faq",
                "config": {
                    "items": [
                        {"question": "¿Atienden 24h?", "answer": "Sí"},
                        {"question": "¿Dan garantía?", "answer": "Sí, 1 año"},
                    ]
                },
            }
        ]
    )
    html = _compile(config, template_name="pseo")
    faq = next(b for b in _jsonld_blocks(html) if b["@type"] == "FAQPage")
    assert len(faq["mainEntity"]) == 2
    assert faq["mainEntity"][0]["name"] == "¿Atienden 24h?"
    assert faq["mainEntity"][1]["acceptedAnswer"]["text"] == "Sí, 1 año"


def test_compile_pseo_jsonld_escapes_script_breakout() -> None:
    malicious = "</script><script>alert(1)</script>"
    config = _pseo_config()
    config["seo_programmatic"]["service_name"] = malicious
    html = _compile(config, template_name="pseo")

    assert "</script><script>" not in html
    service = next(b for b in _jsonld_blocks(html) if b["@type"] == "Service")
    assert service["name"] == malicious


def test_compile_pseo_omits_optional_jsonld_when_absent() -> None:
    html = _compile(_pseo_config(), template_name="pseo")
    assert {b["@type"] for b in _jsonld_blocks(html)} == {"Service"}
