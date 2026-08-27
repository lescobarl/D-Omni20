"""Pruebas del JSON Schema Draft 2020-12 del config extendido PSEO (Fase A).

Verifica que ``EXTENDED_CONFIG_SCHEMA`` es un Draft 2020-12 válido y que, vía
``SchemaValidatorService``, acepta configs extendidos correctos y rechaza los
que incumplen el contrato (tipos erróneos, claves desconocidas, campos
requeridos ausentes).
"""

from __future__ import annotations

from typing import Any

from jsonschema import Draft202012Validator

from app.schemas.pseo_config_schema import EXTENDED_CONFIG_SCHEMA
from app.services.schema_validator import SchemaValidatorService


def _validate(data: dict[str, Any] | None = None):
    """Valida ``data`` contra el schema extendido vía ``SchemaValidatorService``."""
    return SchemaValidatorService().validate(schema=EXTENDED_CONFIG_SCHEMA, data=data)


def _valid_extended_config() -> dict[str, Any]:
    """Config extendido válido que debe pasar la validación sin issues."""
    return {
        "title": "Fontanero en Madrid",
        "workflowType": "lead_capture",
        "blocks": [{"type": "hero", "data": {"headline": "Hola"}}],
        "brand_voice": {
            "tone": "cercano y profesional",
            "custom_instructions": "Menciona la garantía de 30 días",
        },
        "seo_programmatic": {
            "city": "Madrid",
            "service_slug": "fontanero-24h",
            "service_name": "Fontanero 24h",
            "offer_price": "desde 49€",
        },
        "geo_optimization": {
            "local_business": {
                "name": "Fontanería Rápida",
                "city": "Madrid",
                "geo": {"latitude": 40.4168, "longitude": -3.7038},
            },
            "service_areas": ["Centro", "Chamberí"],
            "target_radius_km": 15,
        },
        "metadata_template": {
            "title_template": "{service_name} en {city} | desde {offer_price}",
            "description_template": "¿Necesitas {service_name} en {city}?",
            "h1_template": "{service_name} en {city}",
        },
    }


def test_extended_config_schema_is_valid_draft_2020_12() -> None:
    # check_schema lanza SchemaError si el propio schema no es un Draft 2020-12 válido.
    Draft202012Validator.check_schema(EXTENDED_CONFIG_SCHEMA)


def test_schema_validator_accepts_valid_extended_config() -> None:
    result = _validate(_valid_extended_config())
    assert result.valid is True
    assert result.errors == 0
    assert result.issues == []


def test_schema_validator_accepts_config_without_extended_keys() -> None:
    # Un config base (solo title/workflowType/blocks) sigue siendo válido.
    config = {"title": "Landing", "workflowType": "direct_checkout", "blocks": []}
    result = _validate(config)
    assert result.valid is True


def test_schema_validator_rejects_brand_voice_non_object() -> None:
    config = _valid_extended_config()
    config["brand_voice"] = "un tono"  # brand_voice debe ser objeto
    result = _validate(config)
    assert result.valid is False
    assert result.errors >= 1


def test_schema_validator_rejects_unknown_top_level_key() -> None:
    config = _valid_extended_config()
    config["campo_inventado"] = {"nope": True}
    result = _validate(config)
    assert result.valid is False


def test_schema_validator_rejects_missing_required_seo_fields() -> None:
    config = _valid_extended_config()
    del config["seo_programmatic"]["service_slug"]  # required
    result = _validate(config)
    assert result.valid is False


def test_schema_validator_rejects_extra_key_in_brand_voice() -> None:
    config = _valid_extended_config()
    config["brand_voice"]["clave_extra"] = "no permitida"
    result = _validate(config)
    assert result.valid is False
