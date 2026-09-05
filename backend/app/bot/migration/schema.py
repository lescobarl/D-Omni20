"""Esquema versionado de exportación de datos de OmniBot_IA (Fase M).

Formato de intercambio (JSON) que el proyecto heredado **OmniBot_IA** puede
producir y que este paquete importa de forma idempotente hacia:
``content_items``, ``catalog_items``, ``tenant_channels``,
``bot_company_providers``, ``bot_conversations`` y ``bot_messages``.

Reglas del formato ``1.0``:
- Los decimales se serializan como **string** (``price``, ``temperature``).
- Las fechas son **ISO 8601** (se normalizan a UTC al importar).
- ``access_token``/``webhook_secret`` de canales y ``api_key`` de proveedores
  viajan en texto plano y se **cifran** en reposo al importar (``TokenCipher``).
- Las conversaciones referencian su canal por ``channel_phone_number`` (clave
  natural estable del canal WhatsApp).
- ``messages[].message_id`` es opcional; si falta, el importador deriva un id
  determinista para garantizar idempotencia.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

SCHEMA_VERSION = "1.0"

ContentKind = Literal["faq", "document", "rule", "product"]
ChannelType = Literal["whatsapp"]
ProviderKind = Literal["local", "llm"]
MessageDirection = Literal["inbound", "outbound"]

# Longitudes máximas espejo de las columnas destino (sin hard-codear valores sueltos).
_TITLE_MAX = 255
_SKU_MAX = 64
_PHONE_MAX = 32
_EXTERNAL_ID_MAX = 255
_MESSAGE_ID_MAX = 128
_PROVIDER_KIND_MAX = 16
_QUEUE_STATUS_MAX = 16
_DIRECTION_MAX = 16
_STATE_MAX = 64
_PHONE_NUMBER_ID_MAX = 64
_MODEL_MAX = 128
_ACCESS_TOKEN_MAX = 4096
_WEBHOOK_SECRET_MAX = 1024
_API_KEY_MAX = 4096
_PROMPT_BASE_MAX = 20000


class ExportedContentItem(BaseModel):
    """Elemento de la base de conocimiento (KB) del bot heredado."""

    model_config = ConfigDict(extra="forbid")

    kind: ContentKind
    title: str = Field(min_length=1, max_length=_TITLE_MAX)
    content: str = ""
    tags: list[str] = Field(default_factory=list)
    version: int = Field(default=1, ge=1)


class ExportedCatalogItem(BaseModel):
    """Producto/servicio del catálogo del bot heredado."""

    model_config = ConfigDict(extra="forbid")

    sku: str = Field(min_length=1, max_length=_SKU_MAX)
    name: str = Field(min_length=1, max_length=_TITLE_MAX)
    description: str | None = None
    price: Decimal = Field(default=Decimal("0"), ge=0, max_digits=12, decimal_places=2)
    currency: str = Field(default="MXN", min_length=3, max_length=3)
    available: bool = True
    metadata: dict = Field(default_factory=dict)
    version: int = Field(default=1, ge=1)


class ExportedChannel(BaseModel):
    """Canal del bot (WhatsApp Cloud API) configurado en la empresa heredada."""

    model_config = ConfigDict(extra="forbid")

    channel_type: ChannelType = "whatsapp"
    external_id: str | None = Field(default=None, max_length=_EXTERNAL_ID_MAX)
    phone_number: str = Field(min_length=1, max_length=_PHONE_MAX)
    phone_number_id: str | None = Field(default=None, max_length=_PHONE_NUMBER_ID_MAX)
    access_token: str = Field(default="", max_length=_ACCESS_TOKEN_MAX)
    webhook_secret: str = Field(default="", max_length=_WEBHOOK_SECRET_MAX)
    enabled: bool = True


class ExportedProvider(BaseModel):
    """Proveedor de IA configurado para la empresa heredada (orden + modelo)."""

    model_config = ConfigDict(extra="forbid")

    provider_kind: ProviderKind
    order: int = Field(default=0, ge=0)
    enabled: bool = True
    model: str | None = Field(default=None, max_length=_MODEL_MAX)
    temperature: Decimal | None = Field(default=None, ge=0, max_digits=3, decimal_places=2)
    api_key: str = Field(default="", max_length=_API_KEY_MAX)
    prompt_base: str = Field(default="", max_length=_PROMPT_BASE_MAX)


class ExportedMessage(BaseModel):
    """Mensaje del bot heredado (entrante/saliente)."""

    model_config = ConfigDict(extra="forbid")

    message_id: str | None = Field(default=None, max_length=_MESSAGE_ID_MAX)
    direction: MessageDirection
    content: str = ""
    provider_used: str | None = Field(default=None, max_length=_MODEL_MAX)
    tokens_used: int = Field(default=0, ge=0)
    queue_status: str = Field(default="pending", max_length=_QUEUE_STATUS_MAX)
    created_at: datetime | None = None


class ExportedConversation(BaseModel):
    """Conversación del bot heredado, referenciando su canal por teléfono."""

    model_config = ConfigDict(extra="forbid")

    channel_phone_number: str = Field(min_length=1, max_length=_PHONE_MAX)
    external_contact_id: str = Field(min_length=1, max_length=_EXTERNAL_ID_MAX)
    state: str = Field(default="new", max_length=_STATE_MAX)
    last_message_at: datetime | None = None
    messages: list[ExportedMessage] = Field(default_factory=list)


class OmniBotExport(BaseModel):
    """Documento raíz de exportación (schema_version 1.0)."""

    model_config = ConfigDict(extra="forbid")

    schema_version: str = SCHEMA_VERSION
    exported_at: datetime
    source: str = "OmniBot_IA"
    tenant_slug: str = Field(min_length=1, max_length=_EXTERNAL_ID_MAX)
    knowledge_base: list[ExportedContentItem] = Field(default_factory=list)
    catalog: list[ExportedCatalogItem] = Field(default_factory=list)
    channels: list[ExportedChannel] = Field(default_factory=list)
    providers: list[ExportedProvider] = Field(default_factory=list)
    conversations: list[ExportedConversation] = Field(default_factory=list)
