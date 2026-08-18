"""Pruebas del compilador de landings (Jinja2, alineado a ``ILandingConfig``)."""

from __future__ import annotations

import pytest

from app.core.errors import InputValidationError
from app.services.compiler_service import JinjaCompilerService


def _compile(config: dict, template_name: str = "default") -> str:
    return JinjaCompilerService().compile(config=config, template_name=template_name)


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


def test_compile_non_dict_raises_input_validation() -> None:
    with pytest.raises(InputValidationError) as exc_info:
        JinjaCompilerService().compile(config="no soy dict")  # type: ignore[arg-type]
    assert exc_info.value.operation == "landing.compile"
    assert exc_info.value.context == {"template_name": "default"}


def test_compile_unknown_template_falls_back_to_default() -> None:
    html = _compile({"title": "Fallback"}, template_name="no-existe")
    assert "<title>Fallback</title>" in html
