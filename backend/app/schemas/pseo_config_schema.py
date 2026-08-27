"""JSON Schema Draft 2020-12 del config extendido de landings PSEO (Fase A).

Define el contrato formal de los 4 campos extendidos que añade la extensión
PSEO + GEO + Brand Voice al config de una landing:

- ``brand_voice``: tono y estilo de marca (``tone`` + ``custom_instructions``).
- ``seo_programmatic``: datos de la fila de matriz (ciudad, servicio, precio).
- ``geo_optimization``: datos de negocio local para SEO local (LocalBusiness).
- ``metadata_template``: plantillas de metadatos SEO (title, description, H1).

El schema se valida con ``SchemaValidatorService`` (Draft 2020-12) en el upload
de matriz y en compile. ``additionalProperties: false`` en cada nivel refuerza el
whitelist de claves (misma filosofía que ``_validate_config``).
"""

from __future__ import annotations

from typing import Any

#: Referencia Draft 2020-12 usada por ``SchemaValidatorService``.
JSON_SCHEMA_DRAFT_2020_12 = "https://json-schema.org/draft/2020-12/schema"

_BRAND_VOICE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "tone": {"type": "string"},
        "custom_instructions": {"type": "string"},
    },
}

_SEO_PROGRAMMATIC_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["city", "service_slug", "service_name", "offer_price"],
    "properties": {
        "city": {"type": "string"},
        "service_slug": {"type": "string"},
        "service_name": {"type": "string"},
        "offer_price": {"type": "string"},
    },
}

_LOCAL_BUSINESS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "name": {"type": "string"},
        "address": {"type": "string"},
        "city": {"type": "string"},
        "state": {"type": "string"},
        "country": {"type": "string"},
        "postal_code": {"type": "string"},
        "phone": {"type": "string"},
        "geo": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "latitude": {"type": "number"},
                "longitude": {"type": "number"},
            },
        },
    },
}

_GEO_OPTIMIZATION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "local_business": _LOCAL_BUSINESS_SCHEMA,
        "service_areas": {"type": "array", "items": {"type": "string"}},
        "target_radius_km": {"type": "number"},
    },
}

_METADATA_TEMPLATE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "title_template": {"type": "string"},
        "description_template": {"type": "string"},
        "h1_template": {"type": "string"},
    },
}

#: Schema completo del config extendido (keys whitelisteadas + campos base).
EXTENDED_CONFIG_SCHEMA: dict[str, Any] = {
    "$schema": JSON_SCHEMA_DRAFT_2020_12,
    "$id": "https://omnibotia.studio/schemas/pseo-extended-config.schema.json",
    "title": "ExtendedConfig",
    "description": (
        "Config extendido (PSEO + GEO + Brand Voice) de una landing OmniBotIA."
    ),
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "title": {"type": "string"},
        "workflowType": {"type": "string"},
        "blocks": {
            "type": "array",
            "items": {"type": "object"},
        },
        "brand_voice": _BRAND_VOICE_SCHEMA,
        "seo_programmatic": _SEO_PROGRAMMATIC_SCHEMA,
        "geo_optimization": _GEO_OPTIMIZATION_SCHEMA,
        "metadata_template": _METADATA_TEMPLATE_SCHEMA,
    },
}

__all__ = ["EXTENDED_CONFIG_SCHEMA"]
