"""Modelos de operación del bot para el control plane (Bloque B de LAE Omni2.0).

Regla CLAUDE: son modelos de configuración/operación del tenant (igual que
``app.models.tenant_config``), por lo que viven en ``app.models`` y se importan
de forma eager desde ``app.models.__init__`` (NO importan ``app.bot.models``,
así que no hay ciclo de importación). Todos heredan
``TenantScopedMixin`` → RLS multi-tenant y filtrado por repositorio.

Tablas (8):
- ``bot_contacts``: directorio de contactos del tenant (B.6 Contactos).
- ``bot_templates``: plantillas de mensajes con variables ``{{ }}`` (B.5).
- ``bot_navigation_trees``: árboles de navegación del bot (B.3).
- ``bot_campaigns``: campañas de envío masivo/individual (B.4).
- ``bot_campaign_recipients``: estado por destinatario de campaña (B.4).
- ``bot_campaign_recipient_files``: archivos de destinatarios reutilizables (GAP 2).
- ``bot_interventions``: intervención humana pendiente/resuelta (B.7).
- ``bot_maintenance_config``: reglas de retención y mantenimiento (B.9).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import (
    Base,
    JSONType,
    SyncTupleMixin,
    TenantScopedMixin,
    TimestampsMixin,
    UUIDPrimaryKeyMixin,
)


class BotContact(Base, UUIDPrimaryKeyMixin, TimestampsMixin, SyncTupleMixin, TenantScopedMixin):
    """Contacto del tenant (directorio) — fuente para campañas y atribución."""

    __tablename__ = "bot_contacts"
    __table_args__ = (
        UniqueConstraint("tenant_id", "phone", name="uq_bot_contacts_tenant_phone"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    phone: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    tags: Mapped[list[str]] = mapped_column(JSONType, nullable=False, default=list)
    state: Mapped[str] = mapped_column(String(32), nullable=False, default="new", index=True)
    source: Mapped[str] = mapped_column(String(32), nullable=False, default="manual")
    external_contact_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    last_contact_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)


class BotTemplate(Base, UUIDPrimaryKeyMixin, TimestampsMixin, SyncTupleMixin, TenantScopedMixin):
    """Plantilla de mensaje del bot (nombre, cuerpo, tipo y variables ``{{ }}``)."""

    __tablename__ = "bot_templates"
    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_bot_templates_tenant_name"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    body: Mapped[str] = mapped_column(Text, nullable=False, default="")
    template_type: Mapped[str] = mapped_column(String(32), nullable=False, default="text")
    variables: Mapped[list[str]] = mapped_column(JSONType, nullable=False, default=list)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)


class BotNavigationTree(Base, UUIDPrimaryKeyMixin, TimestampsMixin, SyncTupleMixin, TenantScopedMixin):
    """Árbol de navegación del bot (flujo con opciones; fuente de menús)."""

    __tablename__ = "bot_navigation_trees"
    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_bot_navigation_trees_tenant_name"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    num_options: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    options: Mapped[list[dict[str, Any]]] = mapped_column(JSONType, nullable=False, default=list)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)


class BotCampaign(Base, UUIDPrimaryKeyMixin, TimestampsMixin, SyncTupleMixin, TenantScopedMixin):
    """Campaña de envío masivo/individual del bot (plantilla + audiencia).

    Segmentación (C-2): ``segment_type`` ∈ {"tags", "event"} con su
    ``segment_config`` (``{"tags": [...], "match": "any"|"all"}`` o contexto del
    evento). Disparo (C-2): ``trigger_type`` ∈ {"scheduled", "event"} con
    ``trigger_event`` ∈ {"checkout.created", "payment.completed"}.
    """

    __tablename__ = "bot_campaigns"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    template_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("bot_templates.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    state: Mapped[str] = mapped_column(String(32), nullable=False, default="draft", index=True)
    schedule: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    segment_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    segment_config: Mapped[dict[str, Any] | None] = mapped_column(JSONType, nullable=True)
    trigger_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    trigger_event: Mapped[str | None] = mapped_column(String(64), nullable=True)
    landing_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("tenant_landings.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    last_triggered_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)


class BotCampaignRecipient(Base, UUIDPrimaryKeyMixin, TimestampsMixin, SyncTupleMixin, TenantScopedMixin):
    """Destinatario de una campaña (estado por envío, resultado y reintentos)."""

    __tablename__ = "bot_campaign_recipients"
    __table_args__ = (
        UniqueConstraint("campaign_id", "contact_id", name="uq_bot_campaign_recipients_campaign_contact"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    campaign_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("bot_campaigns.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    contact_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("bot_contacts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    state: Mapped[str] = mapped_column(String(32), nullable=False, default="pending", index=True)
    result: Mapped[str | None] = mapped_column(String(255), nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)


class BotCampaignRecipientFile(Base, UUIDPrimaryKeyMixin, TimestampsMixin, SyncTupleMixin, TenantScopedMixin):
    """Archivo de destinatarios reutilizable (GAP 2) — CSV crudo + metadatos de origen."""

    __tablename__ = "bot_campaign_recipient_files"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    content_type: Mapped[str] = mapped_column(String(128), nullable=False)
    raw_csv: Mapped[str] = mapped_column(Text, nullable=False)
    source_meta: Mapped[dict[str, Any]] = mapped_column(JSONType, nullable=False, default=dict)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)


class BotIntervention(Base, UUIDPrimaryKeyMixin, TimestampsMixin, SyncTupleMixin, TenantScopedMixin):
    """Intervención humana sobre una conversación (cola B.7 → eslabón ⑤)."""

    __tablename__ = "bot_interventions"

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
    state: Mapped[str] = mapped_column(String(32), nullable=False, default="pending", index=True)
    operator: Mapped[str | None] = mapped_column(String(255), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    assigned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)


class BotMaintenanceConfig(Base, UUIDPrimaryKeyMixin, TimestampsMixin, SyncTupleMixin, TenantScopedMixin):
    """Reglas de retención y mantenimiento programado por tenant (B.9)."""

    __tablename__ = "bot_maintenance_config"
    __table_args__ = (
        UniqueConstraint("tenant_id", name="uq_bot_maintenance_config_tenant"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    retention_rules: Mapped[dict[str, Any]] = mapped_column(JSONType, nullable=False, default=dict)
    maintenance_schedule: Mapped[str | None] = mapped_column(String(64), nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
