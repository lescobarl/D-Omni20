"""Modelos de ejecución del bot OmniBotIA (Fase 3).

Regla CLAUDE: el bot NO posee configuración de tenant ni credenciales; solo
persiste datos de ejecución con RLS multi-tenant:
- ``bot_company_providers``: orden y configuración de los proveedores de IA
  por empresa (la ``api_key`` va cifrada en ``api_key_ref``; la versión
  descifrada solo vive en memoria como atributo transitorio).
- ``bot_conversations``: conversaciones por canal y contacto externo.
- ``bot_messages``: mensajes entrantes/salientes (fuente de verdad de la cola
  D3; ``message_id`` permite idempotencia y ``queue_status`` el recorrido
  pending → processing → sent/failed/dlq).
- ``bot_queue_meta``: metadatos de la cola Redis por tenant y stream.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import (
    Base,
    SyncTupleMixin,
    TenantScopedMixin,
    TimestampsMixin,
    UUIDPrimaryKeyMixin,
)


class BotCompanyProvider(Base, UUIDPrimaryKeyMixin, TimestampsMixin, SyncTupleMixin, TenantScopedMixin):
    """Proveedor de IA configurado para una empresa (orden + modelo + prompt)."""

    __tablename__ = "bot_company_providers"
    __table_args__ = (
        UniqueConstraint("tenant_id", "provider_kind", "order", name="uq_bot_provider_kind_order"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    provider_kind: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    model: Mapped[str | None] = mapped_column(String(128), nullable=True)
    temperature: Mapped[Decimal | None] = mapped_column(Numeric(3, 2), nullable=True)
    api_key_ref: Mapped[str] = mapped_column(Text, nullable=False, default="")
    prompt_base: Mapped[str] = mapped_column(Text, nullable=False, default="")

    # Atributo transitorio (NO columna): clave descifrada solo en memoria.
    api_key: str = ""


class BotConversation(Base, UUIDPrimaryKeyMixin, TimestampsMixin, SyncTupleMixin, TenantScopedMixin):
    """Conversación del bot por canal y contacto externo (estado + última actividad)."""

    __tablename__ = "bot_conversations"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "channel_id", "external_contact_id", name="uq_bot_conversation_channel_contact"
        ),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    channel_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("tenant_channels.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    external_contact_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    state: Mapped[str] = mapped_column(String(64), nullable=False, default="new")
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ad_campaign_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("ad_campaigns.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )


class BotMessage(Base, UUIDPrimaryKeyMixin, TimestampsMixin, SyncTupleMixin, TenantScopedMixin):
    """Mensaje del bot (entrante/saliente) — fuente de verdad de la cola D3."""

    __tablename__ = "bot_messages"
    __table_args__ = (
        UniqueConstraint("message_id", name="uq_bot_messages_message_id"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("bot_conversations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    direction: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    provider_used: Mapped[str | None] = mapped_column(String(32), nullable=True)
    tokens_used: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    message_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    queue_status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending", index=True)

    # Atributo transitorio (NO columna): intentos de procesamiento (PEL de D3).
    attempts: int = 0


class BotQueueMeta(Base, UUIDPrimaryKeyMixin, TimestampsMixin, SyncTupleMixin, TenantScopedMixin):
    """Metadatos de la cola Redis (D3) por tenant y stream."""

    __tablename__ = "bot_queue_meta"
    __table_args__ = (
        UniqueConstraint("tenant_id", "stream", name="uq_bot_queue_meta_stream"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    stream: Mapped[str] = mapped_column(String(255), nullable=False)
    last_processed_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    dlq_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
