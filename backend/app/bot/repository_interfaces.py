"""Puertos (ABC) de repositorios del subsistema bot — inversión de dependencias (regla CLAUDE: DI).

Acceso a las entidades de ejecución del bot (``BotCompanyProvider``,
``BotConversation`` y ``BotMessage``) SIEMPRE acotado al tenant. Las
implementaciones SQLAlchemy viven en :mod:`app.bot.repositories`.
"""

from __future__ import annotations

import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal

from app.bot.models import BotCompanyProvider, BotConversation, BotMessage, BotQueueMeta


@dataclass(frozen=True, slots=True)
class BotUsageAggregate:
    """Consumo agregado por proveedor dentro de la ventana de la cuota (L1)."""

    provider_used: str | None
    tokens_used: int
    message_count: int


@dataclass(frozen=True, slots=True)
class BotActiveConversation:
    """Vista de negocio de una conversación activa para el Monitor (Fase 7).

    Modelo de lectura plano (sin ORM) que agrega la actividad de la
    conversación: último mensaje, contador y no leídos (entrantes desde el
    último saliente). Se valida en ``ActiveConversationRead`` vía
    ``from_attributes=True``.
    """

    id: uuid.UUID
    tenant_id: uuid.UUID
    channel_id: uuid.UUID
    external_contact_id: str
    state: str
    is_active: bool
    message_count: int
    unread_count: int
    last_message_content: str | None
    last_message_direction: str | None
    last_message_at: datetime | None
    updated_at: datetime | None


class IBotProviderRepository(ABC):
    """Proveedores de IA configurados por empresa (orden + modelo + prompt)."""

    @abstractmethod
    def get_by_kind_order(
        self, *, tenant_id: uuid.UUID, provider_kind: str, order: int
    ) -> BotCompanyProvider | None: ...

    @abstractmethod
    def upsert(
        self,
        *,
        tenant_id: uuid.UUID,
        provider_kind: str,
        order: int,
        enabled: bool,
        model: str | None,
        temperature: Decimal | None,
        api_key_ref: str,
        prompt_base: str,
    ) -> BotCompanyProvider: ...

    @abstractmethod
    def list(self, *, tenant_id: uuid.UUID) -> list[BotCompanyProvider]: ...

    @abstractmethod
    def soft_delete(
        self, *, tenant_id: uuid.UUID, provider_kind: str, order: int
    ) -> bool: ...


class IBotConversationRepository(ABC):
    """Conversaciones del bot por canal y contacto externo (estado + actividad)."""

    @abstractmethod
    def get(self, *, tenant_id: uuid.UUID, conversation_id: uuid.UUID) -> BotConversation | None: ...

    @abstractmethod
    def get_by_channel_contact(
        self, *, tenant_id: uuid.UUID, channel_id: uuid.UUID, external_contact_id: str
    ) -> BotConversation | None: ...

    @abstractmethod
    def upsert(
        self,
        *,
        tenant_id: uuid.UUID,
        channel_id: uuid.UUID,
        external_contact_id: str,
        state: str,
        last_message_at: datetime | None,
    ) -> BotConversation: ...

    @abstractmethod
    def list(
        self, *, tenant_id: uuid.UUID, page: int, page_size: int
    ) -> tuple[list[BotConversation], int]: ...

    @abstractmethod
    def list_active(
        self, *, tenant_id: uuid.UUID, page: int, page_size: int
    ) -> tuple[list[BotActiveConversation], int]:
        """Vista de negocio paginada de conversaciones activas (Monitor, Fase 7).

        Agrega por conversación el último mensaje, el contador de mensajes y
        los no leídos (entrantes desde el último saliente). Determinista y
        acotado al tenant (aislamiento multi-tenant en el propio repositorio).
        """
        ...

    @abstractmethod
    def list_all(self, *, tenant_id: uuid.UUID) -> list[BotConversation]:
        """Todas las conversaciones activas del tenant (exportación M4)."""
        ...

    @abstractmethod
    def delete_all(self, *, tenant_id: uuid.UUID) -> int:
        """Borra físicamente TODAS las conversaciones del tenant (borrado M4)."""
        ...

    @abstractmethod
    def delete_older_than(self, *, tenant_id: uuid.UUID, before: datetime) -> int:
        """Borra físicamente conversaciones inactivas anteriores a ``before`` (retención M4)."""
        ...


class IBotMessageRepository(ABC):
    """Mensajes del bot (entrante/saliente) — fuente de verdad de la cola D3."""

    @abstractmethod
    def get_by_message_id(self, *, tenant_id: uuid.UUID, message_id: str) -> BotMessage | None: ...

    @abstractmethod
    def create(
        self,
        *,
        tenant_id: uuid.UUID,
        conversation_id: uuid.UUID,
        direction: str,
        content: str,
        provider_used: str | None,
        tokens_used: int,
        message_id: str | None,
        queue_status: str,
        created_at: datetime | None = None,
    ) -> BotMessage: ...

    @abstractmethod
    def list_by_conversation(
        self, *, tenant_id: uuid.UUID, conversation_id: uuid.UUID
    ) -> list[BotMessage]: ...

    @abstractmethod
    def list(
        self, *, tenant_id: uuid.UUID, page: int, page_size: int
    ) -> tuple[list[BotMessage], int]: ...

    @abstractmethod
    def update_queue_status(
        self, *, tenant_id: uuid.UUID, message_id: str, queue_status: str
    ) -> BotMessage | None: ...

    @abstractmethod
    def list_by_status(
        self, *, tenant_id: uuid.UUID, queue_status: str, page: int, page_size: int
    ) -> tuple[list[BotMessage], int]: ...

    @abstractmethod
    def count_by_status(self, *, tenant_id: uuid.UUID) -> dict[str, int]: ...

    @abstractmethod
    def aggregate_usage(
        self, *, tenant_id: uuid.UUID, since: datetime
    ) -> list[BotUsageAggregate]:
        """Consumo ``SUM(tokens_used)`` y recuento por proveedor en la ventana (L1)."""
        ...

    @abstractmethod
    def list_all(self, *, tenant_id: uuid.UUID) -> list[BotMessage]:
        """Todos los mensajes activos del tenant (exportación M4)."""
        ...

    @abstractmethod
    def delete_all(self, *, tenant_id: uuid.UUID) -> int:
        """Borra físicamente TODOS los mensajes del tenant (borrado M4)."""
        ...

    @abstractmethod
    def delete_older_than(self, *, tenant_id: uuid.UUID, before: datetime) -> int:
        """Borra físicamente mensajes anteriores a ``before`` (retención M4)."""
        ...


class IBotQueueMetaRepository(ABC):
    """Metadatos de la cola Redis (D3) por tenant y stream (espejo en BD)."""

    @abstractmethod
    def get(self, *, tenant_id: uuid.UUID, stream: str) -> BotQueueMeta | None: ...

    @abstractmethod
    def upsert(self, *, tenant_id: uuid.UUID, stream: str) -> BotQueueMeta: ...

    @abstractmethod
    def increment_dlq(self, *, tenant_id: uuid.UUID, stream: str) -> None: ...

    @abstractmethod
    def list_streams(self) -> list[str]: ...
