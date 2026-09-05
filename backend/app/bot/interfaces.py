"""Puertos (ABC) del subsistema bot OmniBotIA (Fase 3).

Define los contratos entre el núcleo del bot y sus proveedores de IA y canales
a través de inversión de dependencias (regla CLAUDE: DI). El bot depende de
estas abstracciones, nunca de implementaciones concretas, para garantizar:

- Proveedores de IA intercambiables (local determinista, LLM compatible OpenAI).
- Canales de mensajería intercambiables (WhatsApp hoy; SMS/Instagram/… después).
- Un servicio de conversación agnóstico del canal y del modelo.
"""

from __future__ import annotations

import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any


@dataclass(frozen=True)
class InboundMessage:
    """Mensaje entrante normalizado por un adaptador de canal."""

    channel_id: uuid.UUID
    external_contact_id: str
    text: str
    message_id: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class BotResponse:
    """Respuesta del bot lista para ser enviada por el canal."""

    content: str
    provider_kind: str | None = None
    provider_used: str | None = None
    tokens_used: int = 0
    needs_human: bool = False
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ProviderConfig:
    """Configuración de un proveedor de IA para la empresa (resuelta por bundle)."""

    provider_id: uuid.UUID
    provider_kind: str
    order: int
    enabled: bool
    model: str | None = None
    temperature: Decimal | None = None
    prompt_base: str = ""
    api_key: str = ""


@dataclass(frozen=True)
class ConversationContext:
    """Contexto de conversación entregado a los proveedores de IA."""

    tenant_id: uuid.UUID
    conversation_id: uuid.UUID
    channel_id: uuid.UUID
    external_contact_id: str
    provider: ProviderConfig
    history: tuple[dict[str, str], ...] = ()


@dataclass(frozen=True)
class RouterStep:
    """Un paso evaluado por el motor de ruteo (traza de prueba, Fase 4)."""

    order: int
    branch: str
    outcome: str
    detail: str


@dataclass(frozen=True)
class RouterTrace:
    """Resultado del motor de prueba: qué rama decide y por qué (sin efectos).

    La traza reproduce la jerarquía real del bot (keyword → intent →
    general_chat) reutilizando las mismas ramas, pero sin persistir, encolar,
    llamar a workflows ni invocar al proveedor de IA (no contamina datos).
    """

    matched_route: str
    branch: str
    keyword: str | None
    keyword_priority: int | None
    intent: str | None
    response: str | None
    confidence: float
    steps: list[RouterStep]


class IResponseProvider(ABC):
    """Puerto de proveedor de respuesta de IA para el bot."""

    @property
    @abstractmethod
    def kind(self) -> str:
        """Tipo de proveedor (``local``, ``llm``, …)."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Nombre legible del proveedor para logs y métricas."""

    @abstractmethod
    def respond(
        self,
        *,
        user_message: str,
        conversation_context: ConversationContext,
    ) -> BotResponse:
        """Produce la respuesta del bot para el mensaje del usuario."""


class IConversationService(ABC):
    """Puerto del caso de uso de conversación del bot."""

    @abstractmethod
    def handle_inbound(
        self,
        *,
        message: InboundMessage,
        adapter: IChannelAdapter,
    ) -> BotResponse:
        """Procesa un mensaje entrante y devuelve la respuesta del bot."""

    @abstractmethod
    def route_for_test(self, *, tenant_id: uuid.UUID, message: str) -> RouterTrace:
        """Traza qué rama del router decidiría un mensaje crudo, sin efectos.

        Ejecuta la misma jerarquía real (keyword → intent → general_chat) sin
        persistir datos, encolar, llamar a workflows ni invocar al proveedor
        de IA. Es el motor de "Probar router" (Fase 4): ver qué rama decide
        y por qué, sin contaminar datos.
        """


class IChannelAdapter(ABC):
    """Puerto de adaptador de canal de mensajería (WhatsApp, SMS, …)."""

    @property
    @abstractmethod
    def kind(self) -> str:
        """Tipo de canal (``whatsapp``, ``sms``, …)."""

    @abstractmethod
    def parse_inbound(self, *, payload: Any) -> InboundMessage:
        """Normaliza un payload crudo del canal a :class:`InboundMessage`."""

    @abstractmethod
    def send(self, *, reply: BotResponse, message: InboundMessage) -> bool:
        """Envía la respuesta al contacto a través del canal."""


class IChannelSenderFactory(ABC):
    """Fábrica de adaptadores de canal por ``channel_id`` (Fase 6.1 — multi-WABA por empresa).

    Resuelve el adaptador concreto del canal desde ``tenant_channels`` (credenciales
    cifradas en reposo) para permitir un sender por WABA sin fallback global.
    """

    @abstractmethod
    def resolve(self, *, channel_id: uuid.UUID) -> IChannelAdapter | None:
        """Resuelve el adaptador concreto del canal. None si no existe o no es soportado."""
