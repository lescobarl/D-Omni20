"""Esquemas de configuración del tenant para el bot (Fase 2).

Contrato público de los endpoints ``/tenant/appearance``, ``/content``,
``/catalog`` y ``/channels`` (regla CLAUDE: schema público validado).

Notas de diseño:
- ``TenantChannelRead`` NO expone secretos: ``access_token`` y
  ``webhook_secret`` son *write-only* (solo presentes en create/update).
- ``CatalogItemRead.metadata`` lee el atributo ORM ``metadata_json``
  (columna ``metadata``) y se serializa como ``metadata`` en el JSON.
- Los esquemas de lectura extienden :class:`ORMModel` y :class:`SyncFields`
  (tupla sync ``[revision, updated_at, deleted]`` para replicación).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import ORMModel, SyncFields

# Color hexadecimal: #RRGGBB o #RRGGBBAA (String(9) en el modelo).
COLOR_PATTERN = r"^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$"

ContentKind = Literal["faq", "document", "rule", "product", "portal"]
# C-3 — Portales multired: WhatsApp, SMS (Twilio), Instagram, Messenger y Webchat.
ChannelType = Literal["whatsapp", "sms", "instagram", "messenger", "webchat"]


class TenantAppearanceUpsert(BaseModel):
    """Payload completo de apariencia (PUT idempotente, reemplaza la paleta)."""

    model_config = ConfigDict(extra="forbid")

    primary_color: str = Field(default="#2563EB", pattern=COLOR_PATTERN)
    accent_color: str = Field(default="#7C3AED", pattern=COLOR_PATTERN)
    surface_color: str = Field(default="#FFFFFF", pattern=COLOR_PATTERN)
    text_color: str = Field(default="#0F172A", pattern=COLOR_PATTERN)
    brand_badge: str = Field(default="#2563EB", pattern=COLOR_PATTERN)
    logo_url: str | None = Field(default=None, max_length=512)
    font_family: str | None = Field(default=None, max_length=128)


class TenantAppearanceRead(ORMModel, SyncFields):
    """Apariencia vigente del tenant, tal como se expone a los clientes."""

    id: uuid.UUID
    tenant_id: uuid.UUID
    primary_color: str
    accent_color: str
    surface_color: str
    text_color: str
    brand_badge: str
    logo_url: str | None
    font_family: str | None
    version: int
    created_at: datetime


class ExtractUrlRequest(BaseModel):
    """Solicitud de extracción de estilos desde una URL de marca (Fase 5)."""

    model_config = ConfigDict(extra="forbid")

    url: str = Field(
        min_length=8,
        max_length=2048,
        pattern=r"^https?://[^\s]+$",
        examples=["https://example.com"],
    )


class AppearanceProposal(BaseModel):
    """Propuesta de apariencia derivada de una URL (paleta, tipografía y logo).

    Todos los campos de color son opcionales: la extracción puede no encontrar
    un valor para alguna de las variables CSS. ``detected_fonts`` recoge las
    tipografías declaradas en la página (ordenadas por frecuencia de aparición).
    """

    model_config = ConfigDict(extra="forbid")

    primary_color: str | None = None
    accent_color: str | None = None
    surface_color: str | None = None
    text_color: str | None = None
    brand_badge: str | None = None
    logo_url: str | None = None
    font_family: str | None = None
    detected_fonts: list[str] = Field(default_factory=list)


class RebrandingConfigCreate(BaseModel):
    """Payload para guardar una configuración de rebranding (Fase 5).

    ``url`` es opcional: si se omite (``None``), el backend guarda una
    instantánea de los estilos actuales del tenant como backup (GAP 3). Si se
    proporciona, se extraen los estilos de esa URL de marca.
    """

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=255)
    url: str | None = Field(
        default=None,
        min_length=8,
        max_length=2048,
        pattern=r"^https?://[^\s]+$",
        examples=["https://example.com"],
    )


class RebrandingConfigRead(ORMModel, SyncFields):
    """Configuración de rebranding guardada, tal como se expone al cliente."""

    id: uuid.UUID
    tenant_id: uuid.UUID
    name: str
    url: str
    extracted: dict[str, Any]
    applied_at: datetime | None
    version: int
    created_at: datetime


class ContentItemCreate(BaseModel):
    """Payload para crear un ítem de contenido estructurado del bot."""

    model_config = ConfigDict(extra="forbid")

    kind: ContentKind
    title: str = Field(min_length=1, max_length=255)
    content: str = ""
    tags: list[str] = Field(default_factory=list)


class ContentItemUpdate(BaseModel):
    """Payload parcial para actualizar un ítem de contenido (PUT)."""

    model_config = ConfigDict(extra="forbid")

    kind: ContentKind | None = None
    title: str | None = Field(default=None, min_length=1, max_length=255)
    content: str | None = None
    tags: list[str] | None = None


class ContentItemRead(ORMModel, SyncFields):
    """Ítem de contenido tal como se expone a los clientes."""

    id: uuid.UUID
    tenant_id: uuid.UUID
    kind: ContentKind
    title: str
    content: str
    tags: list[str]
    version: int
    created_at: datetime


class CatalogItemCreate(BaseModel):
    """Payload para crear un producto/servicio del catálogo del tenant."""

    model_config = ConfigDict(extra="forbid")

    sku: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    price: Decimal = Field(default=Decimal("0"), ge=0, max_digits=12, decimal_places=2)
    currency: str = Field(default="MXN", min_length=3, max_length=3)
    available: bool = True
    metadata: dict[str, Any] = Field(default_factory=dict)


class CatalogItemUpdate(BaseModel):
    """Payload parcial para actualizar un ítem del catálogo (PUT)."""

    model_config = ConfigDict(extra="forbid")

    sku: str | None = Field(default=None, min_length=1, max_length=64)
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    price: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    available: bool | None = None
    metadata: dict[str, Any] | None = None


class CatalogItemRead(ORMModel, SyncFields):
    """Ítem del catálogo tal como se expone a los clientes."""

    id: uuid.UUID
    tenant_id: uuid.UUID
    sku: str
    name: str
    description: str | None
    price: Decimal
    currency: str
    available: bool
    # Lee el atributo ORM ``metadata_json`` (columna ``metadata``) y se
    # serializa como ``metadata`` en el JSON de respuesta.
    metadata: dict[str, Any] = Field(validation_alias="metadata_json", serialization_alias="metadata")
    version: int
    created_at: datetime


class TenantChannelCreate(BaseModel):
    """Payload para crear un canal del bot (secretos write-only)."""

    model_config = ConfigDict(extra="forbid")

    channel_type: ChannelType = "whatsapp"
    external_id: str | None = Field(default=None, max_length=255)
    phone_number: str = Field(min_length=1, max_length=32)
    phone_number_id: str | None = Field(default=None, max_length=64)
    access_token: str = Field(default="", max_length=4096)
    webhook_secret: str = Field(default="", max_length=1024)
    enabled: bool = True


class TenantChannelUpdate(BaseModel):
    """Payload parcial para actualizar un canal (PATCH; secretos opcionales)."""

    model_config = ConfigDict(extra="forbid")

    channel_type: ChannelType | None = None
    external_id: str | None = Field(default=None, max_length=255)
    phone_number: str | None = Field(default=None, min_length=1, max_length=32)
    phone_number_id: str | None = Field(default=None, max_length=64)
    access_token: str | None = Field(default=None, max_length=4096)
    webhook_secret: str | None = Field(default=None, max_length=1024)
    enabled: bool | None = None


class TenantChannelRead(ORMModel, SyncFields):
    """Canal del bot tal como se expone (NUNCA incluye secretos).

    ``channel_type`` es ``str`` (consulta-permisiva) porque la BD puede contener
    tipos no soportados por el producto (p. ej. ``instagram`` sembrado por scripts
    dev); la fábrica de canales los resuelve fail-closed y la lectura debe reflejar
    esa realidad sin romper (500). La escritura (``TenantChannelCreate``/
    ``TenantChannelUpdate``) sí es estricta (``Literal["whatsapp"]``).
    """

    id: uuid.UUID
    tenant_id: uuid.UUID
    channel_type: str
    external_id: str | None
    phone_number: str
    phone_number_id: str | None
    enabled: bool
    created_at: datetime
