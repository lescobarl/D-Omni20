"""Servicio de cola D3 (Fase 5.1) — punto único de entrada del webhook del bot.

``BotQueueService`` orquesta la persistencia en BD (fuente de verdad) y el
encolado en Redis Streams garantizando D3 del plan de integración:

1. Persistir el mensaje en ``bot_messages`` (BD) dentro de una transacción.
2. ``XADD`` del stream ``bot:queue:{tenant_id}`` DESPUÉS del commit (fuera de
   la transacción) para no bloquear la BD con la latencia de Redis.
3. Responder 200 al webhook; el worker procesa de forma asíncrona.

Fail-closed: si la BD o Redis fallan, se loguea y se devuelve ``False``; los
mensajes quedan ``pending`` en ``bot_messages`` para re-encolado posterior
(``requeue_pending``).
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import UTC

from sqlalchemy.orm import Session

from app.bot.queue.interfaces import IQueue, QueueStats
from app.bot.repository_interfaces import (
    IBotConversationRepository,
    IBotMessageRepository,
    IBotQueueMetaRepository,
)
from app.config.settings import Settings
from app.core.database import Database
from app.core.logging import ILogger
from app.core.tenancy import set_app_current_tenant
from app.models.base import utcnow

# Estados de la cola D3 (espejo de ``BotMessage.queue_status``).
QUEUE_PENDING = "pending"
QUEUE_PROCESSING = "processing"
QUEUE_SENT = "sent"
QUEUE_FAILED = "failed"
QUEUE_DLQ = "dlq"

DIRECTION_INBOUND = "inbound"
DIRECTION_OUTBOUND = "outbound"
CONVERSATION_STATE_ACTIVE = "active"

# Página de re-encolado (lote acotado por transacción).
_REQUEUE_PAGE_SIZE = 200


class BotQueueService:
    """Servicio de enlace BD ↔ Redis Streams para la cola D3."""

    def __init__(
        self,
        *,
        database: Database,
        queue: IQueue,
        message_repository_factory: Callable[[Session], IBotMessageRepository],
        conversation_repository_factory: Callable[[Session], IBotConversationRepository],
        queue_meta_repository_factory: Callable[[Session], IBotQueueMetaRepository],
        settings: Settings,
        logger: ILogger,
    ) -> None:
        self._database = database
        self._queue = queue
        self._message_repository_factory = message_repository_factory
        self._conversation_repository_factory = conversation_repository_factory
        self._queue_meta_repository_factory = queue_meta_repository_factory
        self._settings = settings
        self._logger = logger

    # ── Helpers ────────────────────────────────────────────────────────────

    def _stream_for(self, tenant_id: uuid.UUID) -> str:
        return f"{self._settings.bot_queue_stream_prefix}:{tenant_id}"

    @staticmethod
    def _set_tenant(session: Session, tenant_id: uuid.UUID) -> None:
        set_app_current_tenant(session.connection(), str(tenant_id))

    @staticmethod
    def _stream_fields(
        *,
        message_id: str,
        conversation_id: uuid.UUID,
        channel_id: uuid.UUID,
        external_contact_id: str,
        direction: str,
        content: str,
    ) -> dict[str, str]:
        return {
            "message_id": message_id,
            "conversation_id": str(conversation_id),
            "channel_id": str(channel_id),
            "external_contact_id": external_contact_id,
            "direction": direction,
            "content": content,
            "attempts": "0",
        }

    # ── API pública ────────────────────────────────────────────────────────

    def enqueue_inbound(
        self,
        *,
        tenant_id: uuid.UUID,
        channel_id: uuid.UUID,
        external_contact_id: str,
        message_id: str,
        content: str,
        direction: str = DIRECTION_INBOUND,
        provider_used: str | None = None,
    ) -> bool:
        """Persiste el mensaje en BD y lo encola en Redis Streams (D3).

        Idempotente por ``message_id``: dentro de la ventana de deduplicación se
        ignora; fuera de la ventana se reactiva el MISMO registro (respeta
        ``uq_bot_messages_message_id``) y se re-encola.
        """
        stream = self._stream_for(tenant_id)
        now = utcnow()
        conversation_id: uuid.UUID | None = None

        try:
            with self._database.session_scope() as session:
                self._set_tenant(session, tenant_id)
                message_repo = self._message_repository_factory(session)
                conversation_repo = self._conversation_repository_factory(session)
                queue_meta_repo = self._queue_meta_repository_factory(session)

                conversation = conversation_repo.upsert(
                    tenant_id=tenant_id,
                    channel_id=channel_id,
                    external_contact_id=external_contact_id,
                    state=CONVERSATION_STATE_ACTIVE,
                    last_message_at=now,
                )
                conversation_id = conversation.id

                existing = message_repo.get_by_message_id(
                    tenant_id=tenant_id, message_id=message_id
                )
                if existing is not None:
                    created_at = existing.created_at or now
                    if created_at.tzinfo is None:
                        # SQLite devuelve ``datetime`` naive; se normaliza a UTC
                        # consciente de zona para poder restar contra ``now``.
                        created_at = created_at.replace(tzinfo=UTC)
                    age = (now - created_at).total_seconds()
                    if age <= self._settings.bot_queue_dedupe_window_seconds:
                        self._logger.warning(
                            "bot.queue.duplicate",
                            "Mensaje duplicado dentro de la ventana de deduplicación.",
                            tenant_id=str(tenant_id),
                            message_id=message_id,
                        )
                        return False
                    message_repo.update_queue_status(
                        tenant_id=tenant_id,
                        message_id=message_id,
                        queue_status=QUEUE_PENDING,
                    )
                else:
                    message_repo.create(
                        tenant_id=tenant_id,
                        conversation_id=conversation.id,
                        direction=direction,
                        content=content,
                        provider_used=provider_used,
                        tokens_used=0,
                        message_id=message_id,
                        queue_status=QUEUE_PENDING,
                    )

                queue_meta_repo.upsert(tenant_id=tenant_id, stream=stream)
        except Exception as exc:  # noqa: BLE001 — fail-closed: BD fuera de servicio
            self._logger.error(
                "bot.queue.enqueue.db.error",
                "No se pudo persistir/encolar el mensaje (fail-closed).",
                tenant_id=str(tenant_id),
                message_id=message_id,
                error=str(exc),
            )
            return False

        if conversation_id is None:
            self._logger.error(
                "bot.queue.enqueue.db.error",
                "No se obtuvo conversación tras persistir el mensaje.",
                tenant_id=str(tenant_id),
                message_id=message_id,
            )
            return False

        fields = self._stream_fields(
            message_id=message_id,
            conversation_id=conversation_id,
            channel_id=channel_id,
            external_contact_id=external_contact_id,
            direction=direction,
            content=content,
        )
        entry_id = self._queue.enqueue(stream, fields)
        if entry_id is None:
            self._logger.error(
                "bot.queue.enqueue.redis.error",
                "XADD falló; el mensaje queda pending en BD para re-encolado.",
                tenant_id=str(tenant_id),
                stream=stream,
                message_id=message_id,
            )
            return False

        self._logger.info(
            "bot.queue.enqueued",
            "Mensaje persistido y encolado en Redis Streams.",
            tenant_id=str(tenant_id),
            stream=stream,
            message_id=message_id,
            entry_id=entry_id,
        )
        return True

    def requeue_pending(self, *, tenant_id: uuid.UUID) -> int:
        """Re-encola en Redis los mensajes ``pending`` en BD (recuperación D3)."""
        stream = self._stream_for(tenant_id)
        reenqueued = 0
        page = 1

        while True:
            with self._database.session_scope() as session:
                self._set_tenant(session, tenant_id)
                message_repo = self._message_repository_factory(session)
                conversation_repo = self._conversation_repository_factory(session)

                messages, total = message_repo.list_by_status(
                    tenant_id=tenant_id,
                    queue_status=QUEUE_PENDING,
                    page=page,
                    page_size=_REQUEUE_PAGE_SIZE,
                )
                for message in messages:
                    if message.conversation_id is None or message.message_id is None:
                        continue
                    conversation = conversation_repo.get(
                        tenant_id=tenant_id,
                        conversation_id=message.conversation_id,
                    )
                    if conversation is None:
                        continue
                    fields = self._stream_fields(
                        message_id=message.message_id,
                        conversation_id=message.conversation_id,
                        channel_id=conversation.channel_id,
                        external_contact_id=conversation.external_contact_id,
                        direction=message.direction,
                        content=message.content,
                    )
                    if self._queue.enqueue(stream, fields) is not None:
                        reenqueued += 1

                if page * _REQUEUE_PAGE_SIZE >= total:
                    break
                page += 1

        self._logger.info(
            "bot.queue.requeue",
            "Re-encolado de mensajes pendientes completado.",
            tenant_id=str(tenant_id),
            stream=stream,
            reenqueued=reenqueued,
        )
        return reenqueued

    def queue_stats(self, *, tenant_id: uuid.UUID) -> QueueStats:
        """Estadísticas combinadas BD (fuente de verdad) + Redis (cola viva)."""
        stream = self._stream_for(tenant_id)
        group = self._settings.bot_worker_group
        length = self._queue.xlen(stream)
        pending = self._queue.pending(stream, group)
        lag = self._queue.consumer_lag(stream, group)

        dlq_count = 0
        enqueued = 0
        processed = 0
        failed = 0

        with self._database.session_scope() as session:
            self._set_tenant(session, tenant_id)
            meta = self._queue_meta_repository_factory(session).get(
                tenant_id=tenant_id, stream=stream
            )
            if meta is not None:
                dlq_count = meta.dlq_count
            counts = self._message_repository_factory(session).count_by_status(
                tenant_id=tenant_id
            )
            enqueued = counts.get(QUEUE_PENDING, 0)
            processed = counts.get(QUEUE_SENT, 0)
            failed = counts.get(QUEUE_FAILED, 0)

        return QueueStats(
            stream=stream,
            length=length,
            pending=pending,
            consumer_lag=lag,
            dlq_count=dlq_count,
            enqueued=enqueued,
            processed=processed,
            failed=failed,
        )

    def list_streams(self) -> list[str]:
        """Lista los streams conocidos (metadatos en BD)."""
        with self._database.session_scope() as session:
            return self._queue_meta_repository_factory(session).list_streams()

    def mark_message_status(
        self, *, tenant_id: uuid.UUID, message_id: str, queue_status: str
    ) -> bool:
        """Actualiza el estado de un mensaje en BD (espejo del procesamiento)."""
        with self._database.session_scope() as session:
            self._set_tenant(session, tenant_id)
            updated = self._message_repository_factory(session).update_queue_status(
                tenant_id=tenant_id,
                message_id=message_id,
                queue_status=queue_status,
            )
            return updated is not None

    def increment_dlq(self, *, tenant_id: uuid.UUID) -> None:
        """Incrementa el contador de DLQ del tenant (metadatos en BD)."""
        stream = self._stream_for(tenant_id)
        with self._database.session_scope() as session:
            self._set_tenant(session, tenant_id)
            self._queue_meta_repository_factory(session).increment_dlq(
                tenant_id=tenant_id, stream=stream
            )

    def close(self) -> None:
        """Cierra la conexión subyacente a Redis."""
        self._queue.close()


__all__ = [
    "BotQueueService",
    "DIRECTION_INBOUND",
    "DIRECTION_OUTBOUND",
    "QUEUE_DLQ",
    "QUEUE_FAILED",
    "QUEUE_PENDING",
    "QUEUE_PROCESSING",
    "QUEUE_SENT",
]
