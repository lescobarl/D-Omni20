"""Servicio de migración de datos de OmniBot_IA hacia OmniBotIA Studio (Fase M).

Importa de forma idempotente un :class:`OmniBotExport` (JSON versionado)
hacia las tablas destino:
``content_items``, ``catalog_items``, ``tenant_channels``,
``bot_company_providers``, ``bot_conversations`` y ``bot_messages``.

Reglas de diseño (regla CLAUDE):
- El servicio recibe **puertos** (ABC) en el constructor; no crea dependencias
  (``NO new``). La fábrica :func:`build_migration_service` es el composition root.
- Idempotencia: clave natural por sección. El flag ``overwrite`` decide si se
  actualizan los registros existentes o se omiten.
- Los mensajes son **append-only**: un mensaje existente SIEMPRE se omite
  (``overwrite`` NO aplica a los logs de mensajes).
- ``message_id`` derivado incluye el ``tenant_id`` porque la restricción
  ``uq_bot_messages_message_id`` es GLOBAL (sin tenant).
- Los secretos (``access_token``, ``webhook_secret``, ``api_key``) viajan en
  texto plano en el export; el repositorio de canales los cifra en reposo.
  ``api_key`` de proveedores se guarda tal cual en ``api_key_ref`` (documentado).
- Al final se valida la paridad entre el export y la base (qué debe coincidir).
"""

from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable

from app.bot.migration.schema import SCHEMA_VERSION, OmniBotExport
from app.bot.repositories import (
    SqlAlchemyBotConversationRepository,
    SqlAlchemyBotMessageRepository,
    SqlAlchemyBotProviderRepository,
)
from app.bot.repository_interfaces import (
    IBotConversationRepository,
    IBotMessageRepository,
    IBotProviderRepository,
)
from app.core.encryption import TokenCipher
from app.core.logging import ILogger
from app.models.tenant_config import ContentItem, TenantChannel
from app.repositories.interfaces import (
    ICatalogItemRepository,
    IContentItemRepository,
    ITenantChannelRepository,
)
from app.repositories.sqlalchemy_repositories import (
    SqlAlchemyCatalogItemRepository,
    SqlAlchemyContentItemRepository,
    SqlAlchemyTenantChannelRepository,
)


@dataclass
class MigrationCounts:
    """Contadores mutables de la importación (por sección y por acción)."""

    content_created: int = 0
    content_updated: int = 0
    content_skipped: int = 0
    catalog_created: int = 0
    catalog_updated: int = 0
    catalog_skipped: int = 0
    channels_created: int = 0
    channels_updated: int = 0
    channels_skipped: int = 0
    providers_created: int = 0
    providers_updated: int = 0
    providers_skipped: int = 0
    conversations_created: int = 0
    conversations_updated: int = 0
    conversations_skipped: int = 0
    messages_created: int = 0
    messages_skipped: int = 0
    errors: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        """Serialización plana para el reporte (JSON-friendly)."""
        data: dict[str, Any] = {
            "knowledge_base": {
                "created": self.content_created,
                "updated": self.content_updated,
                "skipped": self.content_skipped,
            },
            "catalog": {
                "created": self.catalog_created,
                "updated": self.catalog_updated,
                "skipped": self.catalog_skipped,
            },
            "channels": {
                "created": self.channels_created,
                "updated": self.channels_updated,
                "skipped": self.channels_skipped,
            },
            "providers": {
                "created": self.providers_created,
                "updated": self.providers_updated,
                "skipped": self.providers_skipped,
            },
            "conversations": {
                "created": self.conversations_created,
                "updated": self.conversations_updated,
                "skipped": self.conversations_skipped,
            },
            "messages": {
                "created": self.messages_created,
                "skipped": self.messages_skipped,
            },
            "errors": list(self.errors),
        }
        return data


@dataclass(frozen=True)
class ParityIssue:
    """Desviación de paridad entre el export y el estado persistido."""

    section: str
    key: str
    expected: Any
    found: Any
    detail: str = ""


@dataclass(frozen=True)
class ParityReport:
    """Resultado de la validación de paridad de datos."""

    issues: list[ParityIssue] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return len(self.issues) == 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "issues": [
                {
                    "section": issue.section,
                    "key": issue.key,
                    "expected": issue.expected,
                    "found": issue.found,
                    "detail": issue.detail,
                }
                for issue in self.issues
            ],
        }


@dataclass(frozen=True)
class MigrationReport:
    """Reporte completo de una ejecución de migración."""

    counts: MigrationCounts
    parity: ParityReport

    @property
    def ok(self) -> bool:
        return len(self.counts.errors) == 0 and self.parity.ok

    def to_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "counts": self.counts.to_dict(),
            "parity": self.parity.to_dict(),
        }


class OmniBotMigrationService:
    """Caso de uso de migración (regla CLAUDE: DI — recibe puertos, no ``new``)."""

    _CHANNEL_TYPE = "whatsapp"

    def __init__(
        self,
        *,
        tenant_id: uuid.UUID,
        content_repo: IContentItemRepository,
        catalog_repo: ICatalogItemRepository,
        channel_repo: ITenantChannelRepository,
        provider_repo: IBotProviderRepository,
        conversation_repo: IBotConversationRepository,
        message_repo: IBotMessageRepository,
        logger: ILogger | None = None,
    ) -> None:
        self._tenant_id = tenant_id
        self._content_repo = content_repo
        self._catalog_repo = catalog_repo
        self._channel_repo = channel_repo
        self._provider_repo = provider_repo
        self._conversation_repo = conversation_repo
        self._message_repo = message_repo
        self._logger = logger

    # ── Helpers de soporte ───────────────────────────────────────────────────────

    def _log(self, event: str, message: str = "", **fields: Any) -> None:
        if self._logger is not None:
            self._logger.info(event, message, **fields)

    @staticmethod
    def _as_utc(value: datetime) -> datetime:
        """Normaliza a UTC consciente: naive → UTC; consciente → ``astimezone(UTC)``."""
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)

    @staticmethod
    def _derive_message_id(
        *,
        tenant_id: uuid.UUID,
        channel_phone: str,
        contact: str,
        direction: str,
        content: str,
        created_at: datetime | None,
    ) -> str:
        """Id determinista para mensajes sin ``message_id``.

        Incluye ``tenant_id`` en el hash porque ``uq_bot_messages_message_id`` es
        GLOBAL; sin el tenant, dos empresas podrían derivar ids colisionantes.
        """
        created = created_at.isoformat() if created_at is not None else ""
        raw = "|".join(
            [str(tenant_id), channel_phone, contact, direction, content, created]
        )
        digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]
        return f"mig:{digest}"

    def _find_content(self, *, kind: str, title: str) -> ContentItem | None:
        """Localiza contenido por clave natural ``(kind, title)``."""
        for item in self._content_repo.get_by_kind(tenant_id=self._tenant_id, kind=kind):
            if item.title == title:
                return item
        return None

    def _build_channel_phone_map(self) -> dict[str, TenantChannel]:
        """Mapa teléfono → canal WhatsApp (primero gana ante duplicados)."""
        phone_map: dict[str, TenantChannel] = {}
        for channel in self._channel_repo.get_by_type(
            tenant_id=self._tenant_id, channel_type=self._CHANNEL_TYPE
        ):
            phone_map.setdefault(channel.phone_number, channel)
        return phone_map

    # ── Ejecución ────────────────────────────────────────────────────────────────

    def run(self, export: OmniBotExport, *, overwrite: bool = False) -> MigrationReport:
        """Importa el export de forma idempotente y valida la paridad al final."""
        counts = MigrationCounts()
        self._log("migration.start", "inicio de migración", tenant_id=str(self._tenant_id))

        if export.schema_version != SCHEMA_VERSION:
            counts.errors.append(
                f"schema_version: se esperaba {SCHEMA_VERSION}, se recibió {export.schema_version}"
            )

        self._import_knowledge_base(export, counts, overwrite=overwrite)
        self._import_catalog(export, counts, overwrite=overwrite)
        self._import_channels(export, counts, overwrite=overwrite)
        phone_map = self._build_channel_phone_map()
        self._import_providers(export, counts, overwrite=overwrite)
        self._import_conversations(export, counts, phone_map, overwrite=overwrite)

        parity = self.validate(export)
        self._log(
            "migration.finish",
            "fin de migración",
            ok=parity.ok,
            errors=len(counts.errors),
        )
        return MigrationReport(counts=counts, parity=parity)

    def _import_knowledge_base(
        self, export: OmniBotExport, counts: MigrationCounts, *, overwrite: bool
    ) -> None:
        for item in export.knowledge_base:
            key = f"knowledge_base:{item.kind}:{item.title}"
            existing = self._find_content(kind=item.kind, title=item.title)
            if existing is None:
                self._content_repo.create(
                    tenant_id=self._tenant_id,
                    kind=item.kind,
                    title=item.title,
                    content=item.content,
                    tags=item.tags,
                )
                counts.content_created += 1
                self._log("migration.content.created", "contenido creado", key=key)
            elif overwrite:
                self._content_repo.update(
                    tenant_id=self._tenant_id,
                    item_id=existing.id,
                    fields={
                        "content": item.content,
                        "tags": item.tags,
                        "version": item.version,
                    },
                )
                counts.content_updated += 1
                self._log("migration.content.updated", "contenido actualizado", key=key)
            else:
                counts.content_skipped += 1

    def _import_catalog(
        self, export: OmniBotExport, counts: MigrationCounts, *, overwrite: bool
    ) -> None:
        for item in export.catalog:
            key = f"catalog:{item.sku}"
            existing = self._catalog_repo.get_by_sku(tenant_id=self._tenant_id, sku=item.sku)
            if existing is None:
                self._catalog_repo.create(
                    tenant_id=self._tenant_id,
                    sku=item.sku,
                    name=item.name,
                    description=item.description,
                    price=item.price,
                    currency=item.currency,
                    available=item.available,
                    metadata=item.metadata,
                )
                counts.catalog_created += 1
                self._log("migration.catalog.created", "catálogo creado", key=key)
            elif overwrite:
                self._catalog_repo.update(
                    tenant_id=self._tenant_id,
                    item_id=existing.id,
                    fields={
                        "name": item.name,
                        "description": item.description,
                        "price": item.price,
                        "currency": item.currency,
                        "available": item.available,
                        "metadata": item.metadata,
                        "version": item.version,
                    },
                )
                counts.catalog_updated += 1
                self._log("migration.catalog.updated", "catálogo actualizado", key=key)
            else:
                counts.catalog_skipped += 1

    def _import_channels(
        self, export: OmniBotExport, counts: MigrationCounts, *, overwrite: bool
    ) -> None:
        for channel in export.channels:
            key = f"channels:{channel.channel_type}:{channel.external_id}"
            existing = self._channel_repo.get_by_natural_key(
                tenant_id=self._tenant_id,
                channel_type=channel.channel_type,
                external_id=channel.external_id,
            )
            if existing is None:
                self._channel_repo.create(
                    tenant_id=self._tenant_id,
                    channel_type=channel.channel_type,
                    external_id=channel.external_id,
                    phone_number=channel.phone_number,
                    phone_number_id=channel.phone_number_id,
                    access_token=channel.access_token,
                    webhook_secret=channel.webhook_secret,
                    enabled=channel.enabled,
                )
                counts.channels_created += 1
                self._log("migration.channel.created", "canal creado", key=key)
            elif overwrite:
                self._channel_repo.update(
                    tenant_id=self._tenant_id,
                    channel_id=existing.id,
                    fields={
                        "phone_number": channel.phone_number,
                        "phone_number_id": channel.phone_number_id,
                        "access_token": channel.access_token,
                        "webhook_secret": channel.webhook_secret,
                        "enabled": channel.enabled,
                    },
                )
                counts.channels_updated += 1
                self._log("migration.channel.updated", "canal actualizado", key=key)
            else:
                counts.channels_skipped += 1

    def _import_providers(
        self, export: OmniBotExport, counts: MigrationCounts, *, overwrite: bool
    ) -> None:
        for provider in export.providers:
            key = f"providers:{provider.provider_kind}:{provider.order}"
            existing = self._provider_repo.get_by_kind_order(
                tenant_id=self._tenant_id,
                provider_kind=provider.provider_kind,
                order=provider.order,
            )
            # ``api_key`` viaja en texto plano y se guarda tal cual en ``api_key_ref``
            # (el cifrado de proveedores queda para Fase 4, documentado en el plan).
            fields = {
                "enabled": provider.enabled,
                "model": provider.model,
                "temperature": provider.temperature,
                "api_key_ref": provider.api_key,
                "prompt_base": provider.prompt_base,
            }
            if existing is None:
                self._provider_repo.upsert(
                    tenant_id=self._tenant_id,
                    provider_kind=provider.provider_kind,
                    order=provider.order,
                    **fields,
                )
                counts.providers_created += 1
                self._log("migration.provider.created", "proveedor creado", key=key)
            elif overwrite:
                self._provider_repo.upsert(
                    tenant_id=self._tenant_id,
                    provider_kind=provider.provider_kind,
                    order=provider.order,
                    **fields,
                )
                counts.providers_updated += 1
                self._log("migration.provider.updated", "proveedor actualizado", key=key)
            else:
                counts.providers_skipped += 1

    def _import_conversations(
        self,
        export: OmniBotExport,
        counts: MigrationCounts,
        phone_map: dict[str, TenantChannel],
        *,
        overwrite: bool,
    ) -> None:
        for conv in export.conversations:
            key = f"conversations:{conv.external_contact_id}"
            channel = phone_map.get(conv.channel_phone_number)
            if channel is None:
                counts.errors.append(
                    f"{key}: canal {conv.channel_phone_number} no importado; "
                    "conversación omitida"
                )
                counts.conversations_skipped += 1
                continue

            last_message_at = (
                self._as_utc(conv.last_message_at) if conv.last_message_at is not None else None
            )
            existing = self._conversation_repo.get_by_channel_contact(
                tenant_id=self._tenant_id,
                channel_id=channel.id,
                external_contact_id=conv.external_contact_id,
            )
            if existing is None:
                conversation = self._conversation_repo.upsert(
                    tenant_id=self._tenant_id,
                    channel_id=channel.id,
                    external_contact_id=conv.external_contact_id,
                    state=conv.state,
                    last_message_at=last_message_at,
                )
                counts.conversations_created += 1
                self._log("migration.conversation.created", "conversación creada", key=key)
            elif overwrite:
                conversation = self._conversation_repo.upsert(
                    tenant_id=self._tenant_id,
                    channel_id=channel.id,
                    external_contact_id=conv.external_contact_id,
                    state=conv.state,
                    last_message_at=last_message_at,
                )
                counts.conversations_updated += 1
                self._log("migration.conversation.updated", "conversación actualizada", key=key)
            else:
                conversation = existing
                counts.conversations_skipped += 1

            self._import_messages(
                conv, conversation.id, channel.phone_number, counts
            )

    def _import_messages(
        self,
        conv: Any,
        conversation_id: uuid.UUID,
        channel_phone: str,
        counts: MigrationCounts,
    ) -> None:
        """Importa mensajes de una conversación (append-only, idempotente)."""
        for message in conv.messages:
            message_id = message.message_id or self._derive_message_id(
                tenant_id=self._tenant_id,
                channel_phone=channel_phone,
                contact=conv.external_contact_id,
                direction=message.direction,
                content=message.content,
                created_at=message.created_at,
            )
            key = f"messages:{message_id}"
            existing = self._message_repo.get_by_message_id(
                tenant_id=self._tenant_id, message_id=message_id
            )
            if existing is not None:
                # Append-only: los logs de mensajes nunca se sobreescriben.
                counts.messages_skipped += 1
                continue
            created_at = (
                self._as_utc(message.created_at) if message.created_at is not None else None
            )
            self._message_repo.create(
                tenant_id=self._tenant_id,
                conversation_id=conversation_id,
                direction=message.direction,
                content=message.content,
                provider_used=message.provider_used,
                tokens_used=message.tokens_used,
                message_id=message_id,
                queue_status=message.queue_status,
                created_at=created_at,
            )
            counts.messages_created += 1
            self._log("migration.message.created", "mensaje creado", key=key)

    # ── Validación de paridad ────────────────────────────────────────────────────

    def validate(self, export: OmniBotExport) -> ParityReport:
        """Compara el export contra el estado persistido y reporta desviaciones."""
        issues: list[ParityIssue] = []

        if export.schema_version != SCHEMA_VERSION:
            issues.append(
                ParityIssue(
                    section="schema",
                    key="schema_version",
                    expected=SCHEMA_VERSION,
                    found=export.schema_version,
                )
            )

        for item in export.knowledge_base:
            found = self._find_content(kind=item.kind, title=item.title)
            if found is None:
                issues.append(
                    ParityIssue(
                        section="knowledge_base",
                        key=f"{item.kind}:{item.title}",
                        expected="found",
                        found=None,
                        detail="no existe en content_items",
                    )
                )
            elif found.content != item.content or found.tags != item.tags:
                issues.append(
                    ParityIssue(
                        section="knowledge_base",
                        key=f"{item.kind}:{item.title}",
                        expected={"content": item.content, "tags": item.tags},
                        found={"content": found.content, "tags": found.tags},
                        detail="el contenido persistido difiere del export",
                    )
                )

        for item in export.catalog:
            found = self._catalog_repo.get_by_sku(tenant_id=self._tenant_id, sku=item.sku)
            if found is None:
                issues.append(
                    ParityIssue(
                        section="catalog",
                        key=item.sku,
                        expected="found",
                        found=None,
                        detail="no existe en catalog_items",
                    )
                )
            elif found.name != item.name or found.price != item.price:
                issues.append(
                    ParityIssue(
                        section="catalog",
                        key=item.sku,
                        expected={"name": item.name, "price": str(item.price)},
                        found={"name": found.name, "price": str(found.price)},
                        detail="nombre o precio difiere del export",
                    )
                )

        for channel in export.channels:
            found = self._channel_repo.get_by_natural_key(
                tenant_id=self._tenant_id,
                channel_type=channel.channel_type,
                external_id=channel.external_id,
            )
            if found is None:
                issues.append(
                    ParityIssue(
                        section="channels",
                        key=f"{channel.channel_type}:{channel.external_id}",
                        expected="found",
                        found=None,
                        detail="no existe en tenant_channels",
                    )
                )
            elif found.phone_number != channel.phone_number:
                issues.append(
                    ParityIssue(
                        section="channels",
                        key=f"{channel.channel_type}:{channel.external_id}",
                        expected=channel.phone_number,
                        found=found.phone_number,
                        detail="el teléfono persistido difiere del export",
                    )
                )

        for provider in export.providers:
            key = f"{provider.provider_kind}:{provider.order}"
            found = self._provider_repo.get_by_kind_order(
                tenant_id=self._tenant_id,
                provider_kind=provider.provider_kind,
                order=provider.order,
            )
            if found is None:
                issues.append(
                    ParityIssue(
                        section="providers",
                        key=key,
                        expected="found",
                        found=None,
                        detail="no existe en bot_company_providers",
                    )
                )
            elif (
                found.model != provider.model
                or found.api_key_ref != provider.api_key
                or found.prompt_base != provider.prompt_base
            ):
                issues.append(
                    ParityIssue(
                        section="providers",
                        key=key,
                        expected={
                            "model": provider.model,
                            "api_key_ref": provider.api_key,
                            "prompt_base": provider.prompt_base,
                        },
                        found={
                            "model": found.model,
                            "api_key_ref": found.api_key_ref,
                            "prompt_base": found.prompt_base,
                        },
                        detail="configuración del proveedor difiere del export",
                    )
                )

        phone_map = self._build_channel_phone_map()
        for conv in export.conversations:
            channel = phone_map.get(conv.channel_phone_number)
            if channel is None:
                issues.append(
                    ParityIssue(
                        section="conversations",
                        key=conv.external_contact_id,
                        expected=conv.channel_phone_number,
                        found=None,
                        detail="canal de la conversación no importado",
                    )
                )
                continue
            found = self._conversation_repo.get_by_channel_contact(
                tenant_id=self._tenant_id,
                channel_id=channel.id,
                external_contact_id=conv.external_contact_id,
            )
            if found is None:
                issues.append(
                    ParityIssue(
                        section="conversations",
                        key=conv.external_contact_id,
                        expected="found",
                        found=None,
                        detail="no existe en bot_conversations",
                    )
                )
                continue
            for message in conv.messages:
                message_id = message.message_id or self._derive_message_id(
                    tenant_id=self._tenant_id,
                    channel_phone=conv.channel_phone_number,
                    contact=conv.external_contact_id,
                    direction=message.direction,
                    content=message.content,
                    created_at=message.created_at,
                )
                if self._message_repo.get_by_message_id(
                    tenant_id=self._tenant_id, message_id=message_id
                ) is None:
                    issues.append(
                        ParityIssue(
                            section="messages",
                            key=message_id,
                            expected="found",
                            found=None,
                            detail=f"mensaje ausente en la conversación {conv.external_contact_id}",
                        )
                    )

        return ParityReport(issues=issues)


def build_migration_service(
    session: Any,
    *,
    tenant_id: uuid.UUID,
    cipher: TokenCipher | None = None,
    logger: ILogger | None = None,
) -> OmniBotMigrationService:
    """Composition root de la migración: cablea las implementaciones SQLAlchemy."""
    return OmniBotMigrationService(
        tenant_id=tenant_id,
        content_repo=SqlAlchemyContentItemRepository(session),
        catalog_repo=SqlAlchemyCatalogItemRepository(session),
        channel_repo=SqlAlchemyTenantChannelRepository(session, cipher=cipher),
        provider_repo=SqlAlchemyBotProviderRepository(session),
        conversation_repo=SqlAlchemyBotConversationRepository(session),
        message_repo=SqlAlchemyBotMessageRepository(session),
        logger=logger,
    )
