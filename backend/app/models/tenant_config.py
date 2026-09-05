"""Modelos de configuración del tenant para el bot OmniBotIA (Fase 1).

Tablas: ``tenant_appearance``, ``content_items``, ``catalog_items`` y
``tenant_channels``. Todas son tenant-scoped (RLS multi-tenant) y portan la
tupla sync ``[revision, updated_at, deleted]`` para replicación incremental.

Los secretos de canales (``encrypted_access_token`` / ``encrypted_webhook_secret``)
se almacenan cifrados en reposo vía ``TokenCipher`` (regla CLAUDE: secrets).
"""

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
    JSONType,
    SyncTupleMixin,
    TenantScopedMixin,
    TimestampsMixin,
    UUIDPrimaryKeyMixin,
)


class TenantAppearance(Base, UUIDPrimaryKeyMixin, TimestampsMixin, SyncTupleMixin, TenantScopedMixin):
    """Apariencia del sitio/landing del tenant (paleta, logo y tipografía)."""

    __tablename__ = "tenant_appearance"
    __table_args__ = (
        UniqueConstraint("tenant_id", name="uq_tenant_appearance_tenant"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    primary_color: Mapped[str] = mapped_column(String(9), nullable=False, default="#2563EB")
    accent_color: Mapped[str] = mapped_column(String(9), nullable=False, default="#7C3AED")
    surface_color: Mapped[str] = mapped_column(String(9), nullable=False, default="#FFFFFF")
    text_color: Mapped[str] = mapped_column(String(9), nullable=False, default="#0F172A")
    brand_badge: Mapped[str] = mapped_column(String(9), nullable=False, default="#2563EB")
    logo_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    font_family: Mapped[str | None] = mapped_column(String(128), nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)


class ContentItem(Base, UUIDPrimaryKeyMixin, TimestampsMixin, SyncTupleMixin, TenantScopedMixin):
    """Contenido estructurado del bot (saludos, menús, respuestas, FAQs)."""

    __tablename__ = "content_items"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    kind: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    tags: Mapped[list] = mapped_column(JSONType, nullable=False, default=list)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)


class CatalogItem(Base, UUIDPrimaryKeyMixin, TimestampsMixin, SyncTupleMixin, TenantScopedMixin):
    """Producto/servicio del catálogo del tenant (nombre, precio y metadata)."""

    __tablename__ = "catalog_items"
    __table_args__ = (
        UniqueConstraint("tenant_id", "sku", name="uq_catalog_tenant_sku"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    sku: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="MXN")
    available: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    metadata_json: Mapped[dict] = mapped_column("metadata", JSONType, nullable=False, default=dict)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)


class TenantChannel(Base, UUIDPrimaryKeyMixin, TimestampsMixin, SyncTupleMixin, TenantScopedMixin):
    """Canal de comunicación del bot (WhatsApp Cloud API) con secretos cifrados."""

    __tablename__ = "tenant_channels"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "channel_type", "external_id", name="uq_tenant_channel_type_external"
        ),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    channel_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    external_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    phone_number: Mapped[str] = mapped_column(String(32), nullable=False)
    phone_number_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    encrypted_access_token: Mapped[str] = mapped_column(Text, nullable=False, default="")
    encrypted_webhook_secret: Mapped[str] = mapped_column(Text, nullable=False, default="")
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # Atributos transitorios (NO columnas, sin ``Mapped``): secretos descifrados
    # que el repositorio expone en texto plano al dominio. No se persisten, por
    # lo que asignarlos nunca re-cifra ni re-escribe las columnas ``encrypted_*``.
    access_token: str = ""
    webhook_secret: str = ""


class BotRebrandingConfig(Base, UUIDPrimaryKeyMixin, TimestampsMixin, SyncTupleMixin, TenantScopedMixin):
    """Configuración de rebranding por URL (paleta, tipografías y logo extraídos).

    Cada fila guarda el resultado ``extracted`` de analizar los estilos de la
    ``url`` de origen de la marca (única por tenant) y cuándo se aplicó a la
    apariencia del tenant (``applied_at``).
    """

    __tablename__ = "bot_rebranding_configs"
    __table_args__ = (
        UniqueConstraint("tenant_id", "url", name="uq_bot_rebranding_configs_tenant_url"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    url: Mapped[str] = mapped_column(String(2048), nullable=False, index=True)
    extracted: Mapped[dict] = mapped_column(JSONType, nullable=False, default=dict)
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
