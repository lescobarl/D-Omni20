"""Esquemas de la API runtime del bot (Fase 5).

Contrato público de los endpoints ``/bot/context`` (m2m, solo-máquina) y de los
webhooks del canal WhatsApp. A diferencia de los esquemas de lectura de
:mod:`app.schemas.tenant_config`, estos NO son :class:`ORMModel`: el
:class:`ContextBundleRead` se ensambla desde un servicio
(:class:`~app.bot.context_bundle_service.ContextBundleService`) que ya descifró
los secretos en memoria por request.

Notas de diseño:
- ``temperature`` se serializa como ``str | None`` (el ``Decimal`` no es JSON-
  nativo; el cliente lo convierte de vuelta con ``Decimal(str(...))`` en
  :meth:`HttpContextBundleClient._parse_bundle`).
- ``content_items`` / ``catalog_items`` son ``dict[str, Any]`` opacos: pasan el
  grounding tal cual al proveedor de respuesta (misma forma que el bundle).
- Este módulo NO expone secretos al cliente de la plataforma: solo el endpoint
  m2m de context bundle los incluye (solo-máquina, bearer service credential).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.common import ORMModel, SyncFields


class BotProviderRead(BaseModel):
    """Proveedor de IA configurado para la empresa dentro del context bundle."""

    model_config = ConfigDict(extra="forbid")

    provider_id: uuid.UUID
    provider_kind: str
    order: int
    enabled: bool
    model: str | None = None
    temperature: str | None = None
    prompt_base: str = ""
    api_key: str = ""


class ContextBundleRead(BaseModel):
    """Context bundle completo de la empresa para un canal (respuesta m2m).

    Es el espejo JSON de :class:`~app.bot.context_bundle.CompanyContextBundle`:
    incluye credenciales del canal **descifradas por request** (solo en memoria)
    y el grounding (``prompt_base`` + contenido + catálogo) que el bot consume.
    """

    model_config = ConfigDict(extra="forbid")

    tenant_id: uuid.UUID
    channel_id: uuid.UUID
    channel_type: str
    phone_number_id: str | None = None
    access_token: str = ""
    webhook_secret: str = ""
    prompt_base: str = ""
    providers: list[BotProviderRead] = Field(default_factory=list)
    content_items: list[dict[str, Any]] = Field(default_factory=list)
    catalog_items: list[dict[str, Any]] = Field(default_factory=list)

    @classmethod
    def from_bundle(cls, bundle: Any) -> ContextBundleRead:
        """Ensambla el esquema desde un :class:`CompanyContextBundle`.

        Importa el tipo localmente para evitar dependencia circular en tiempo de
        importación y mantener el acoplamiento solo en la dirección del servicio
        hacia el contrato (regla CLAUDE: puertos hacia adentro, esquemas hacia
        afuera).
        """
        from app.bot.context_bundle import CompanyContextBundle

        if not isinstance(bundle, CompanyContextBundle):
            raise TypeError(
                "from_bundle espera un CompanyContextBundle, "
                f"recibió {type(bundle).__name__}"
            )
        return cls(
            tenant_id=bundle.tenant_id,
            channel_id=bundle.channel_id,
            channel_type=bundle.channel_type,
            phone_number_id=bundle.phone_number_id,
            access_token=bundle.access_token,
            webhook_secret=bundle.webhook_secret,
            prompt_base=bundle.prompt_base,
            providers=[
                BotProviderRead(
                    provider_id=provider.provider_id,
                    provider_kind=provider.provider_kind,
                    order=provider.order,
                    enabled=provider.enabled,
                    model=provider.model,
                    temperature=(
                        str(provider.temperature) if provider.temperature is not None else None
                    ),
                    prompt_base=provider.prompt_base,
                    api_key=provider.api_key,
                )
                for provider in bundle.providers
            ],
            content_items=list(bundle.content_items),
            catalog_items=list(bundle.catalog_items),
        )


class QueueStatsRead(BaseModel):
    """Estadísticas de la cola Redis D3 de un tenant (respuesta de ``/bot/queue/stats``).

    Ensamblado desde el :class:`~app.bot.queue.interfaces.QueueStats` del servicio
    :class:`~app.bot.queue.service.BotQueueService`, más el ``tenant_id`` explícito
    de la consulta (multi-tenant: una cola por tenant).
    """

    model_config = ConfigDict(extra="forbid")

    tenant_id: uuid.UUID
    stream: str
    length: int = 0
    pending: int = 0
    consumer_lag: int | None = None
    dlq_count: int = 0
    enqueued: int = 0
    processed: int = 0
    failed: int = 0

    @classmethod
    def from_stats(cls, *, tenant_id: uuid.UUID, stats: Any) -> QueueStatsRead:
        """Ensambla el esquema desde un :class:`QueueStats`.

        Importa el tipo localmente para evitar dependencia circular en tiempo de
        importación (mismo patrón que :meth:`ContextBundleRead.from_bundle`).
        """
        from app.bot.queue.interfaces import QueueStats

        if not isinstance(stats, QueueStats):
            raise TypeError(
                "from_stats espera un QueueStats, "
                f"recibió {type(stats).__name__}"
            )
        return cls(
            tenant_id=tenant_id,
            stream=stats.stream,
            length=stats.length,
            pending=stats.pending,
            consumer_lag=stats.consumer_lag,
            dlq_count=stats.dlq_count,
            enqueued=stats.enqueued,
            processed=stats.processed,
            failed=stats.failed,
        )


class ConversationRead(ORMModel, SyncFields):
    """Conversación del bot (Fase 7): estado y última actividad por contacto externo.

    No expone datos sensibles del contacto ni secretos del canal: solo lo
    necesario para el visor de conversaciones del panel de configuración.
    ``ad_campaign_id`` expone la procedencia del lead (landing/campaña que lo
    originó, eslabón ① → ③) para calificar/derivar con contexto.
    """

    id: uuid.UUID
    tenant_id: uuid.UUID
    channel_id: uuid.UUID
    external_contact_id: str
    ad_campaign_id: uuid.UUID | None = None
    state: str = "new"
    last_message_at: datetime | None = None
    created_at: datetime


class MessageRead(ORMModel, SyncFields):
    """Mensaje del bot (Fase 7): entrante/saliente de la fuente de verdad (cola D3)."""

    id: uuid.UUID
    tenant_id: uuid.UUID
    conversation_id: uuid.UUID
    direction: str
    content: str
    provider_used: str | None = None
    tokens_used: int = 0
    message_id: str | None = None
    queue_status: str = "pending"
    created_at: datetime


class BotProviderConfigRead(ORMModel, SyncFields):
    """Proveedor de IA configurado por empresa (Fase 7) — sin secretos.

    A diferencia de :class:`BotProviderRead` (respuesta m2m con ``api_key``
    descifrada), este esquema NUNCA expone ``api_key`` ni ``api_key_ref`` al
    cliente de la plataforma. ``temperature`` se serializa como ``str`` (el
    ``Decimal`` no es JSON-nativo; mismo criterio que el context bundle).
    """

    id: uuid.UUID
    tenant_id: uuid.UUID
    provider_kind: str
    order: int
    enabled: bool
    model: str | None = None
    temperature: str | None = None
    prompt_base: str = ""

    @field_validator("temperature", mode="before")
    @classmethod
    def _temperature_to_str(cls, value: object) -> object:
        """Normaliza ``Decimal``/``None``/``str`` a ``str | None`` para el JSON."""
        if value is None or isinstance(value, str):
            return value
        return str(value)


class BotProviderUpsert(BaseModel):
    """Creación/actualización de un proveedor de IA por empresa (Fase 7).

    NUNCA recibe secretos: la ``api_key_ref`` la gestiona exclusivamente el
    endpoint m2m de context bundle; el ``PUT`` de este recurso preserva la
    referencia existente (si la hubiera).
    """

    model_config = ConfigDict(extra="forbid")

    provider_kind: str = Field(min_length=1, max_length=16)
    order: int = Field(ge=0)
    enabled: bool = True
    model: str | None = Field(default=None, max_length=128)
    temperature: str | None = None
    prompt_base: str = ""

    @field_validator("temperature")
    @classmethod
    def _validate_temperature(cls, value: str | None) -> str | None:
        """Valida que ``temperature`` sea un decimal legible ('' → None)."""
        if value is None or value == "":
            return None
        try:
            Decimal(value)
        except InvalidOperation as exc:
            raise ValueError(
                "temperature debe ser un número decimal válido (p. ej. '0.7')"
            ) from exc
        return value


class MessageCreate(BaseModel):
    """Mensaje de prueba enviado manualmente a la cola D3 (Fase 7)."""

    model_config = ConfigDict(extra="forbid")

    content: str = Field(min_length=1)


class MessageEnqueueResult(BaseModel):
    """Resultado del envío manual de un mensaje a la cola D3 (Fase 7).

    ``enqueue_inbound`` devuelve ``bool`` (idempotencia por dedupe window), así
    que el endpoint devuelve un contrato propio: identificadores + estado de cola
    + si el mensaje fue aceptado.
    """

    model_config = ConfigDict(extra="forbid")

    message_id: str
    conversation_id: uuid.UUID
    direction: str
    queue_status: str
    accepted: bool


class QuotaUsageRead(BaseModel):
    """Consumo agregado de tokens de un proveedor en la ventana (Fase 9b, L1).

    ``status`` refleja la relación entre ``tokens_used`` y ``quota_limit``:
    - ``ok``: sin riesgo.
    - ``warning``: se superó el 80 % de la cuota.
    - ``exceeded``: la cuota se superó por completo (alerta ``bot.quota.exceeded``).
    """

    model_config = ConfigDict(extra="forbid")

    provider_used: str | None
    tokens_used: int = 0
    message_count: int = 0
    quota_limit: int
    percent: float
    status: Literal["ok", "warning", "exceeded"]
    period_start: datetime
    period_end: datetime


class QuotaUsageResponse(BaseModel):
    """Reporte de cuota de tokens del tenant activo (Fase 9b, L1).

    Resumen total + desglose por proveedor de respuesta. La cuota
    (``BOT_QUOTA_DAILY_TOKENS``) es global del tenant; ``0`` = sin límite (solo
    reporte). El reporte NO bloquea el bot: solo informa y emite alertas.
    """

    model_config = ConfigDict(extra="forbid")

    tenant_id: uuid.UUID
    period_start: datetime
    period_end: datetime
    quota_limit: int
    total_tokens_used: int = 0
    total_percent: float
    status: Literal["ok", "warning", "exceeded"]
    items: list[QuotaUsageRead]


class BotDataExportRead(BaseModel):
    """Exportación portable de los datos del bot de un tenant (Fase 9a, M4).

    Ejercicio del derecho de portabilidad (art. 15 LFPDPPP): incluye todas las
    conversaciones y mensajes NO eliminados del tenant como JSON estructurado.
    No incluye secretos (ni de proveedores ni de canales): solo datos del bot.
    """

    model_config = ConfigDict(extra="forbid")

    tenant_id: uuid.UUID
    exported_at: datetime
    conversations: list[ConversationRead]
    messages: list[MessageRead]


class PrivacyDeletionResult(BaseModel):
    """Resultado del borrado físico de datos del bot de un tenant (Fase 9a, M4).

    Ejercicio del derecho de cancelación (art. 16 LFPDPPP): elimina físicamente
    (``DELETE``) las conversaciones y mensajes del tenant. Operación destructiva
    e irreversible, acotada al ``X-Tenant-Id`` del request (aislamiento RLS).
    """

    model_config = ConfigDict(extra="forbid")

    tenant_id: uuid.UUID
    deleted_conversations: int = 0
    deleted_messages: int = 0
