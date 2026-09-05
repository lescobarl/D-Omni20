"""Cola de mensajes del bot (Fase 5.1 — Redis Streams D3).

Exporta el puerto :class:`IQueue`, la implementación :class:`RedisStreamQueue`,
el servicio de enlace BD↔cola :class:`BotQueueService` y el worker en proceso
:class:`BotWorkerPool`. Detalles en ``plans/omnibotia_bot_integration_plan.md``.
"""

from app.bot.queue.interfaces import IQueue, QueueStats, StreamMessage
from app.bot.queue.redis_stream_queue import RedisStreamQueue
from app.bot.queue.service import (
    CONVERSATION_STATE_ACTIVE,
    DIRECTION_INBOUND,
    DIRECTION_OUTBOUND,
    QUEUE_DLQ,
    QUEUE_FAILED,
    QUEUE_PENDING,
    QUEUE_PROCESSING,
    QUEUE_SENT,
    BotQueueService,
)
from app.bot.queue.worker import BotWorkerPool

__all__ = [
    "BotQueueService",
    "BotWorkerPool",
    "CONVERSATION_STATE_ACTIVE",
    "DIRECTION_INBOUND",
    "DIRECTION_OUTBOUND",
    "IQueue",
    "QUEUE_DLQ",
    "QUEUE_FAILED",
    "QUEUE_PENDING",
    "QUEUE_PROCESSING",
    "QUEUE_SENT",
    "QueueStats",
    "RedisStreamQueue",
    "StreamMessage",
]
