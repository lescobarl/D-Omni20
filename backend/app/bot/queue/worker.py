"""Worker pool en proceso de la cola D3 (Fase 5.1, evolución Fase 6.1).

Consume los streams ``bot:queue:{tenant_id}`` con ``XREADGROUP`` + ``XCLAIM``
(PEL) y delega cada mensaje en :meth:`IConversationService.handle_inbound`,
que envía la respuesta vía el adaptador del canal. Fail-closed:

- Dormant cuando NO hay procesador o fábrica de adaptadores (los mensajes quedan
  ``pending``; Fase 6 conecta el ``IConversationService`` concreto y Fase 6.1
  resuelve el adaptador por ``channel_id`` desde ``tenant_channels``).
- El adaptador se resuelve por ``channel_id`` en cada mensaje; si no se resuelve
  (canal inexistente/deshabilitado/sin credenciales) el mensaje se reintenta
  acotado hasta la DLQ, sin duplicar mensajes salientes.
- Mensajes malformados → DLQ + XACK (evita envenenar el PEL).
- Reintento acotado por ``bot_queue_max_attempts``; al agotarse → DLQ + failed.
- Cada tick se aísla en try/except para no detener el pool.
"""

from __future__ import annotations

import threading
import uuid

from app.bot.interfaces import (
    IChannelSenderFactory,
    IConversationService,
    InboundMessage,
)
from app.bot.queue.interfaces import IQueue, StreamMessage
from app.bot.queue.service import QUEUE_FAILED, QUEUE_SENT, BotQueueService
from app.config.settings import Settings
from app.core.logging import ILogger


class BotWorkerPool:
    """Pool de consumidores en hilos delgados sobre la cola D3."""

    def __init__(
        self,
        *,
        queue: IQueue,
        service: BotQueueService,
        processor: IConversationService | None,
        adapter_factory: IChannelSenderFactory | None,
        settings: Settings,
        logger: ILogger,
    ) -> None:
        self._queue = queue
        self._service = service
        self._processor = processor
        self._adapter_factory = adapter_factory
        self._settings = settings
        self._logger = logger
        self._stop_event = threading.Event()
        self._threads: list[threading.Thread] = []

    @property
    def _can_run(self) -> bool:
        return self._processor is not None and self._adapter_factory is not None

    @property
    def is_running(self) -> bool:
        return any(thread.is_alive() for thread in self._threads)

    def start(self) -> None:
        """Arranca el pool; no-op si ya corre o si no hay procesador/fábrica."""
        if self.is_running:
            return
        if not self._can_run:
            self._logger.warning(
                "bot.worker.dormant",
                "Sin procesador o fábrica de adaptadores; el worker queda dormant (fail-closed).",
            )
            return

        self._stop_event.clear()
        self._threads = []
        pool_size = max(self._settings.bot_worker_pool_size, 1)
        for index in range(pool_size):
            consumer = f"bot-worker-{index}"
            thread = threading.Thread(
                target=self._run_loop,
                kwargs={"consumer": consumer},
                name=consumer,
                daemon=True,
            )
            thread.start()
            self._threads.append(thread)

        self._logger.info(
            "bot.worker.started",
            "Pool de consumidores iniciado.",
            pool_size=pool_size,
        )

    def stop(self) -> None:
        """Detiene el pool y espera a que los hilos terminen su tick actual."""
        self._stop_event.set()
        timeout = max(self._settings.bot_worker_poll_interval_seconds * 2, 5.0)
        for thread in self._threads:
            if thread.is_alive():
                thread.join(timeout=timeout)
        self._threads = []
        self._logger.info("bot.worker.stopped", "Pool de consumidores detenido.")

    # ── Ciclo interno ──────────────────────────────────────────────────────

    def _run_loop(self, *, consumer: str) -> None:
        while not self._stop_event.is_set():
            try:
                self._process_once(consumer)
            except Exception as exc:  # noqa: BLE001 — fail-closed por tick
                self._logger.error(
                    "bot.worker.tick.error",
                    "Error en un tick del worker (fail-closed).",
                    consumer=consumer,
                    error=str(exc),
                )
            self._stop_event.wait(timeout=self._settings.bot_worker_poll_interval_seconds)

    def _process_once(self, consumer: str) -> None:
        group = self._settings.bot_worker_group
        count = self._settings.bot_queue_batch_size
        min_idle_ms = int(self._settings.bot_queue_claim_timeout_seconds * 1000)

        for stream in self._service.list_streams():
            for message in self._queue.read_group(stream, group=group, consumer=consumer, count=count):
                self._process_message(message, consumer)
            for message in self._queue.claim(
                stream, group=group, consumer=consumer, min_idle_ms=min_idle_ms, count=count
            ):
                self._process_message(message, consumer)

    def _process_message(self, message: StreamMessage, consumer: str) -> None:
        if self._processor is None or self._adapter_factory is None:
            return

        group = self._settings.bot_worker_group
        fields = message.fields
        message_id = fields.get("message_id", "")

        try:
            tenant_id = self._tenant_from_stream(message.stream)
            channel_id = uuid.UUID(fields["channel_id"])
            external_contact_id = fields["external_contact_id"]
        except (KeyError, ValueError, AttributeError) as exc:
            self._queue.to_dlq(message.stream, fields, reason="malformed")
            self._queue.ack(message.stream, group, message.message_id)
            self._logger.error(
                "bot.worker.malformed",
                "Mensaje malformado movido a DLQ y reconocido.",
                stream=message.stream,
                message_id=message_id,
                error=str(exc),
            )
            return

        inbound = InboundMessage(
            channel_id=channel_id,
            external_contact_id=external_contact_id,
            text=fields.get("content", ""),
            message_id=message_id,
        )

        try:
            adapter = self._adapter_factory.resolve(channel_id=inbound.channel_id)
            if adapter is None:
                raise RuntimeError("No se pudo resolver el adaptador del canal")
            self._processor.handle_inbound(message=inbound, adapter=adapter)
        except Exception as exc:  # noqa: BLE001 — reintento acotado o DLQ
            if message.attempts < self._settings.bot_queue_max_attempts:
                retry_fields = dict(fields)
                retry_fields["attempts"] = str(message.attempts + 1)
                self._queue.enqueue(message.stream, retry_fields)
                self._queue.ack(message.stream, group, message.message_id)
                self._logger.warning(
                    "bot.worker.retry",
                    "Fallo transitorio; mensaje re-encolado.",
                    tenant_id=str(tenant_id),
                    stream=message.stream,
                    message_id=message_id,
                    attempt=message.attempts + 1,
                    error=str(exc),
                )
                return

            self._queue.to_dlq(message.stream, fields, reason=str(exc))
            self._queue.ack(message.stream, group, message.message_id)
            self._service.mark_message_status(
                tenant_id=tenant_id,
                message_id=message_id,
                queue_status=QUEUE_FAILED,
            )
            self._service.increment_dlq(tenant_id=tenant_id)
            self._logger.error(
                "bot.worker.dlq",
                "Reintentos agotados; mensaje movido a DLQ.",
                tenant_id=str(tenant_id),
                stream=message.stream,
                message_id=message_id,
                error=str(exc),
            )
            return

        self._queue.ack(message.stream, group, message.message_id)
        self._service.mark_message_status(
            tenant_id=tenant_id,
            message_id=message_id,
            queue_status=QUEUE_SENT,
        )
        self._logger.info(
            "bot.worker.processed",
            "Mensaje procesado y enviado correctamente.",
            tenant_id=str(tenant_id),
            stream=message.stream,
            message_id=message_id,
            consumer=consumer,
        )

    @staticmethod
    def _tenant_from_stream(stream: str) -> uuid.UUID:
        return uuid.UUID(stream.rsplit(":", 1)[-1])


__all__ = ["BotWorkerPool"]
