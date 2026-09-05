"""Puertos (ABC) de la cola de mensajes del bot (Fase 5.1 — Redis Streams D3).

Define el contrato entre :class:`BotQueueService` / el worker y el motor de la
cola (Redis Streams en producción, ``FakeQueue`` en pruebas) mediante inversión
de dependencias (regla CLAUDE: DI). El núcleo depende de esta abstracción, nunca
de la implementación concreta, para garantizar:

- Mensajería idempotente por ``message_id`` (at-least-once con XACK).
- Multi-tenant: un stream ``bot:queue:{tenant_id}`` por empresa.
- Reintento acotado (PEL + XCLAIM) y DLQ por tenant.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass(frozen=True)
class StreamMessage:
    """Mensaje leído de un stream (lectura de grupo o reclamación XCLAIM)."""

    stream: str
    message_id: str
    fields: dict[str, str] = field(default_factory=dict)
    attempts: int = 0


@dataclass(frozen=True)
class QueueStats:
    """Estadísticas agregadas de la cola D3 para un tenant."""

    stream: str
    length: int = 0
    pending: int = 0
    consumer_lag: int | None = None
    dlq_count: int = 0
    enqueued: int = 0
    processed: int = 0
    failed: int = 0


class IQueue(ABC):
    """Puerto del motor de colas (Redis Streams D3)."""

    @abstractmethod
    def enqueue(self, stream: str, fields: dict[str, str]) -> str | None:
        """Publica un mensaje en el stream y devuelve su ID (``None`` si falla)."""

    @abstractmethod
    def read_group(
        self,
        stream: str,
        group: str,
        consumer: str,
        count: int,
    ) -> list[StreamMessage]:
        """Lee mensajes nuevos del grupo (XREADGROUP) sin bloquear."""

    @abstractmethod
    def ack(self, stream: str, group: str, message_id: str) -> bool:
        """Confirma un mensaje procesado (XACK); ``True`` si se confirmó."""

    @abstractmethod
    def claim(
        self,
        stream: str,
        group: str,
        consumer: str,
        min_idle_ms: int,
        count: int,
    ) -> list[StreamMessage]:
        """Reclama entradas abandonadas del PEL (XCLAIM)."""

    @abstractmethod
    def xlen(self, stream: str) -> int:
        """Longitud actual del stream (XLEN); ``0`` si no existe o falla."""

    @abstractmethod
    def pending(self, stream: str, group: str) -> int:
        """Mensajes sin confirmar del grupo (XPENDING)."""

    @abstractmethod
    def consumer_lag(self, stream: str, group: str) -> int | None:
        """Atraso del grupo (``entries-lag``) o ``None`` si no hay información."""

    @abstractmethod
    def to_dlq(self, stream: str, fields: dict[str, str], reason: str) -> str | None:
        """Mueve un mensaje fallido al DLQ del tenant (deriva del stream)."""

    @abstractmethod
    def close(self) -> None:
        """Cierra los recursos del motor de la cola (best-effort)."""


__all__ = ["IQueue", "QueueStats", "StreamMessage"]
